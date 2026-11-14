import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFonts } from "font-list";
import { type AtRule, CssSyntaxError, parse } from "postcss";
import { describeFailure, fetchBytes, fetchText } from "./remote.ts";

/**
 * Google Fonts caching for mdforge
 *
 * Checks system fonts first, downloads from Google Fonts only if needed.
 * Downloaded fonts are cached in ~/.cache/mdforge/fonts/
 *
 * The CSS this module returns is never Google's text: it is emitted here from
 * validated @font-face facts, with every source a data: URL, so it cannot make
 * the renderer start a network request of its own. A face whose font file
 * could not be downloaded in time is left out (its unicode-range subset falls
 * back to the next font in the stack) and reported as a warning. Only a
 * complete result is cached, and a cache entry is used only after passing the
 * same validation, so a partial or tampered entry is refetched.
 */

const moduleDir: string = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR: string = join(homedir(), ".cache", "mdforge", "fonts");

const GOOGLE_FONTS_LIST: string = join(moduleDir, "..", "data", "google-fonts.json");

// Cache system fonts for the session (avoid repeated lookups)
let systemFontsCache: Set<string> | null = null;

// Cache Google Fonts list for the session
let googleFontsCache: Set<string> | null = null;

/**
 * Get set of installed system font names (cached)
 */
async function getSystemFonts(): Promise<Set<string>> {
  if (systemFontsCache) return systemFontsCache;

  try {
    const fonts = await getFonts();
    // Normalize: remove quotes and lowercase for comparison
    systemFontsCache = new Set(fonts.map((f) => f.replace(/^["']|["']$/g, "").toLowerCase()));
  } catch {
    // If font-list fails, return empty set (will download all fonts)
    systemFontsCache = new Set();
  }

  return systemFontsCache;
}

/**
 * Check if a font is installed on the system
 */
export async function isSystemFont(fontName: string): Promise<boolean> {
  const systemFonts = await getSystemFonts();

  return systemFonts.has(fontName.toLowerCase());
}

/**
 * Get set of Google Fonts family names (cached)
 */
async function getGoogleFonts(): Promise<Set<string>> {
  if (googleFontsCache) return googleFontsCache;

  try {
    const data = await fs.readFile(GOOGLE_FONTS_LIST, "utf-8");
    const names: string[] = JSON.parse(data);
    googleFontsCache = new Set(names); // Already lowercase from build script
  } catch {
    // If list not found, return empty set
    googleFontsCache = new Set();
  }

  return googleFontsCache;
}

/**
 * Check if a font is available on Google Fonts
 */
export async function isGoogleFont(fontName: string): Promise<boolean> {
  const googleFonts = await getGoogleFonts();

  return googleFonts.has(fontName.toLowerCase());
}

// User agent to get woff2 format from Google Fonts
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

export type GoogleFontsOptions = {
  /** Weights requested for every family; defaults to 400, 500, 600, 700. */
  weights?: number[];
  /** Cache directory; defaults to ~/.cache/mdforge/fonts. */
  cacheDir?: string;
  /** Fetch implementation (tests inject one). */
  fetch?: typeof fetch;
  /** Per-request deadline; defaults to REMOTE_TIMEOUT_MS (tests shorten it). */
  timeoutMs?: number;
};

/** Result of font fetch with possible warnings */
export interface FontFetchResult {
  css: string | null;
  warnings: string[];
}

/** One validated @font-face; `source` is a remote URL or base64 woff2 data. */
type FontFace = {
  family: string;
  style: string;
  weight: string;
  unicodeRange: string | undefined;
  source: string;
};

const FAMILY = /^(?:'([A-Za-z0-9 ]+)'|"([A-Za-z0-9 ]+)"|([A-Za-z0-9 ]+))$/;
const STYLE = /^(?:normal|italic)$/;
const MAX_CODE_POINT = 0x10ffff;

/** A weight 1-1000, or an ascending variable range of two. */
function validWeight(value: string): boolean {
  if (!/^\d{1,4}(?: \d{1,4})?$/.test(value)) return false;

  const [low = 0, high = low] = value.split(" ").map(Number);

  return low >= 1 && high <= 1000 && low <= high;
}

/** CSS unicode-range: comma-separated U+X, U+X-Y (ascending) or U+X?? wildcards. */
function validUnicodeRange(value: string): boolean {
  return value.split(",").every((raw) => {
    const item = raw.trim();
    const wildcard = /^U\+([0-9A-Fa-f]{0,5})(\?{1,6})$/.exec(item);

    if (wildcard) {
      const [, hex = "", marks = ""] = wildcard;

      return (
        hex.length + marks.length <= 6 &&
        Number.parseInt(`${hex}${"0".repeat(marks.length)}`, 16) <= MAX_CODE_POINT
      );
    }

    const range = /^U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?$/.exec(item);

    if (!range?.[1]) return false;

    const start = Number.parseInt(range[1], 16);
    const end = range[2] === undefined ? start : Number.parseInt(range[2], 16);

    return start <= end && end <= MAX_CODE_POINT;
  });
}

const FORMAT = `(?:\\s+format\\((?:'woff2'|"woff2")\\))?`;

const REMOTE_SRC = new RegExp(
  `^url\\((https://fonts\\.gstatic\\.com/[A-Za-z0-9._~/-]+\\.woff2)\\)${FORMAT}$`,
);

const EMBEDDED_SRC = new RegExp(`^url\\(data:font/woff2;base64,([A-Za-z0-9+/]+=*)\\)${FORMAT}$`);

/**
 * Read one @font-face. Every descriptor that affects matching must be present
 * (unicode-range only if given) and valid, or the whole face is rejected:
 * dropping a bad descriptor alone would change what the face covers.
 */
function readFace(rule: AtRule, src: RegExp): FontFace | null {
  const values = new Map<string, string>();

  for (const node of rule.nodes ?? []) {
    if (node.type === "comment") continue;

    if (node.type !== "decl") return null;

    values.set(node.prop.toLowerCase(), node.value.trim());
  }

  const family = FAMILY.exec(values.get("font-family") ?? "");
  const style = values.get("font-style") ?? "";
  const weight = values.get("font-weight") ?? "";
  const unicodeRange = values.get("unicode-range");
  const source = src.exec(values.get("src") ?? "");

  if (!(family && STYLE.test(style) && validWeight(weight) && source?.[1])) return null;

  if (unicodeRange !== undefined && !validUnicodeRange(unicodeRange)) return null;

  return {
    family: family[1] ?? family[2] ?? family[3] ?? "",
    style,
    weight,
    unicodeRange,
    source: source[1],
  };
}

/**
 * Parse @font-face rules whose src matches `src`. Anything else at the top
 * level other than comments, and any face that fails validation, counts as
 * rejected. Null if the text is not CSS.
 */
function parseFaces(css: string, src: RegExp): { faces: FontFace[]; rejected: number } | null {
  let root;

  try {
    root = parse(css);
  } catch (error) {
    if (error instanceof CssSyntaxError) return null;
    throw error;
  }

  const faces: FontFace[] = [];
  let rejected = 0;

  for (const node of root.nodes) {
    if (node.type === "comment") continue;

    const face =
      node.type === "atrule" && node.name.toLowerCase() === "font-face"
        ? readFace(node, src)
        : null;

    if (face) {
      faces.push(face);
    } else {
      rejected++;
    }
  }

  return { faces, rejected };
}

/** The only CSS this module emits: a face whose source is embedded woff2. */
function emitFace(face: FontFace, base64: string): string {
  const range = face.unicodeRange === undefined ? "" : `\n  unicode-range: ${face.unicodeRange};`;

  return `@font-face {
  font-family: '${face.family}';
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: swap;
  src: url(data:font/woff2;base64,${base64}) format('woff2');${range}
}`;
}

/**
 * Generate cache key for a font request
 */
function getCacheKey(fontNames: string[], weights: number[]): string {
  const input = `${fontNames.toSorted((a, b) => a.localeCompare(b)).join(",")}:${weights.toSorted((a, b) => a - b).join(",")}`;

  return createHash("md5").update(input).digest("hex");
}

/**
 * Cached CSS, re-emitted from validated faces; null (a miss) unless every
 * rule in the entry is a valid embedded face.
 */
async function getCachedCss(cacheDir: string, cacheKey: string): Promise<string | null> {
  let text: string;

  try {
    text = await fs.readFile(join(cacheDir, `${cacheKey}.css`), "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFaces(text, EMBEDDED_SRC);

  if (!parsed || parsed.rejected > 0 || parsed.faces.length === 0) return null;

  return parsed.faces.map((face) => emitFace(face, face.source)).join("\n");
}

/** Best effort: a failed write leaves no partial file and is otherwise ignored. */
async function saveCachedCss(cacheDir: string, cacheKey: string, css: string): Promise<void> {
  const path = join(cacheDir, `${cacheKey}.css`);
  const tmp = `${path}.${process.pid}-${randomUUID()}.tmp`;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(tmp, css, "utf-8");
    await fs.rename(tmp, path);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/**
 * Fetch Google Fonts CSS and emit self-contained CSS with embedded fonts.
 * `complete` is true only when every face Google listed was embedded.
 */
async function fetchAndEmbedFonts(
  fontNames: string[],
  weights: number[],
  options: GoogleFontsOptions,
): Promise<FontFetchResult & { complete: boolean }> {
  const warnings: string[] = [];
  const names = `"${fontNames.join(", ")}"`;
  const remote = { fetch: options.fetch, timeoutMs: options.timeoutMs };

  const families = fontNames
    .map((name) => `family=${name.replace(/ /g, "+")}:wght@${weights.join(";")}`)
    .join("&");

  const url = `https://fonts.googleapis.com/css2?${families}&display=swap`;

  // Need the user agent to get woff2
  const response = await fetchText(url, { ...remote, headers: { "User-Agent": USER_AGENT } });

  if (!response.ok) {
    warnings.push(
      `Failed to fetch fonts ${names} from Google Fonts: ${describeFailure(response.failure)}`,
    );

    return { css: null, warnings, complete: false };
  }

  const parsed = parseFaces(response.value, REMOTE_SRC);

  if (!parsed) {
    warnings.push(`Failed to fetch fonts ${names} from Google Fonts: response is not CSS`);

    return { css: null, warnings, complete: false };
  }

  if (parsed.rejected > 0) {
    warnings.push(
      `Google Fonts returned ${parsed.rejected} font rule(s) for ${names} that mdforge cannot embed; they were left out`,
    );
  }

  // One download per distinct file, all in parallel, each with its deadline
  const urls = [...new Set(parsed.faces.map((face) => face.source))];

  const downloads = new Map(
    await Promise.all(
      urls.map(async (fontUrl) => [fontUrl, await fetchBytes(fontUrl, remote)] as const),
    ),
  );

  const emitted: string[] = [];
  const failures = new Map<string, { faces: number; reasons: Set<string> }>();

  for (const face of parsed.faces) {
    const download = downloads.get(face.source);

    if (download?.ok) {
      emitted.push(emitFace(face, Buffer.from(download.value).toString("base64")));
      continue;
    }

    const entry = failures.get(face.family) ?? { faces: 0, reasons: new Set<string>() };
    entry.faces++;

    if (download) entry.reasons.add(describeFailure(download.failure));
    failures.set(face.family, entry);
  }

  for (const [family, { faces, reasons }] of failures) {
    warnings.push(
      `Font "${family}": ${faces} font face(s) left out because their Google Fonts file could not be downloaded (${[...reasons].join("; ")})`,
    );
  }

  if (emitted.length === 0 && failures.size === 0) {
    warnings.push(`Google Fonts returned no usable fonts for ${names}`);
  }

  return {
    css: emitted.length > 0 ? emitted.join("\n") : null,
    warnings,
    complete: parsed.rejected === 0 && failures.size === 0 && emitted.length > 0,
  };
}

/**
 * Get font CSS - uses system fonts when available, downloads from Google Fonts otherwise
 *
 * Returns CSS with @font-face rules and any warnings.
 * System fonts are referenced by name, downloaded fonts are embedded as base64.
 */
export async function getGoogleFontsCss(
  fontNames: string[],
  options: GoogleFontsOptions = {},
): Promise<FontFetchResult> {
  if (fontNames.length === 0) return { css: null, warnings: [] };

  const warnings: string[] = [];
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;

  // Separate system fonts from fonts that need downloading
  const systemFonts: string[] = [];
  const fontsToDownload: string[] = [];

  for (const name of fontNames) {
    if (await isSystemFont(name)) {
      systemFonts.push(name);
    } else {
      fontsToDownload.push(name);
    }
  }

  const cssParts: string[] = [];

  // System fonts don't need @font-face - they're referenced directly
  // Just add a comment noting which fonts are from the system
  if (systemFonts.length > 0) {
    cssParts.push(`/* System fonts: ${systemFonts.join(", ")} */`);
  }

  // Download and embed fonts not installed locally
  if (fontsToDownload.length > 0) {
    // Request families and weights in the same sorted order that keys the
    // cache (the Google Fonts css2 API expects ascending weight values).
    const sortedFonts = fontsToDownload.toSorted((a, b) => a.localeCompare(b));
    const sortedWeights = (options.weights ?? [400, 500, 600, 700]).toSorted((a, b) => a - b);
    const cacheKey = getCacheKey(sortedFonts, sortedWeights);

    let downloadedCss = await getCachedCss(cacheDir, cacheKey);

    if (!downloadedCss) {
      const result = await fetchAndEmbedFonts(sortedFonts, sortedWeights, options);
      warnings.push(...result.warnings);
      downloadedCss = result.css;

      if (result.complete && result.css) {
        await saveCachedCss(cacheDir, cacheKey, result.css);
      }
    }

    if (downloadedCss) {
      cssParts.push(downloadedCss);
    }
  }

  return {
    css: cssParts.length > 0 ? cssParts.join("\n\n") : null,
    warnings,
  };
}
