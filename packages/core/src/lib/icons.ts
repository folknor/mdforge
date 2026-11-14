import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Iconify icon support for mdforge
 *
 * Syntax: :icon[prefix:name] or :icon[prefix:name]{size=24}
 * Example: :icon[mdi:home] or :icon[mdi:home]{size=32}
 *
 * Fetched SVGs are cached on disk per server: the cache directory is named by
 * a hash of the canonical server URL (see iconifyBase), so icons fetched from
 * one server are never served for another. The server is an operator setting
 * (config file or programmatic Config); front matter cannot choose it, so a
 * document cannot make the converter contact a host of its choosing or plant
 * SVGs in the cache other documents read. The legacy name-only cache
 * (~/.cache/mdforge/icons) has unknown origin and is never read.
 */

const DEFAULT_ICONIFY_API = "https://api.iconify.design";

const DEFAULT_CACHE_ROOT: string = join(homedir(), ".cache", "mdforge", "iconify");

/**
 * Regex to match icon syntax:
 * :icon[prefix:name] or :icon[prefix:name]{size=24}
 */
const ICON_REGEX = /:icon\[([a-z0-9-]+):([a-z0-9-]+)\](?:\{size=(\d+)\})?/gi;

/**
 * Canonical base URL of an Iconify server. The value names a base directory:
 * `https://host/icons` and `https://host/icons/` are the same server; repeated
 * slashes and case in the path are kept. Only http(s) without credentials,
 * query or fragment is accepted (an icon path appended to a query or fragment
 * would not reach the server). Throws on anything else.
 */
export function iconifyBase(api: string): URL {
  const url = new URL(api);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Iconify server must be an http(s) URL: ${api}`);
  }

  if (url.username || url.password) {
    throw new Error(`Iconify server URL must not contain credentials: ${api}`);
  }

  if (url.search || url.hash || api.includes("?") || api.includes("#")) {
    throw new Error(`Iconify server URL must not have a query or fragment: ${api}`);
  }

  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;

  return new URL(`${url.origin}${pathname}`);
}

export type IconOptions = {
  /** Iconify server; defaults to https://api.iconify.design. */
  apiUrl?: string;
  /** Root of the per-server cache; defaults to ~/.cache/mdforge/iconify. */
  cacheRoot?: string;
  /** Fetch implementation (tests inject one). */
  fetch?: typeof fetch;
};

type IconSource = {
  base: URL;
  cacheDir: string;
  fetch: typeof fetch;
};

function iconCachePath(source: IconSource, prefix: string, name: string): string {
  // Prefix and name are separate path components, so no two ids share a file.
  return join(source.cacheDir, prefix, `${name}.svg`);
}

async function readCached(path: string): Promise<string | null> {
  try {
    const svg = await fs.readFile(path, "utf-8");

    return svg.includes("<svg") ? svg : null;
  } catch {
    return null;
  }
}

/** Best effort: a failed write leaves no partial file and is otherwise ignored. */
async function writeCached(path: string, svg: string): Promise<void> {
  const tmp = `${path}.${process.pid}-${randomUUID()}.tmp`;

  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmp, svg, "utf-8");
    await fs.rename(tmp, path);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function fetchIcon(source: IconSource, prefix: string, name: string): Promise<string | null> {
  const cachePath = iconCachePath(source, prefix, name);
  const cached = await readCached(cachePath);

  if (cached) {
    return cached;
  }

  let svg: string;

  try {
    const response = await source.fetch(new URL(`${prefix}/${name}.svg`, source.base));

    if (!response.ok) {
      return null;
    }

    svg = await response.text();
  } catch {
    return null;
  }

  if (!svg.includes("<svg")) {
    return null;
  }

  await writeCached(cachePath, svg);

  return svg;
}

/**
 * Apply size to SVG
 */
function applySizeToSvg(svg: string, size: number): string {
  // Replace width and height attributes
  return svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
}

/**
 * Create inline SVG with proper styling
 */
function createInlineSvg(svg: string, size?: number): string {
  // Remove XML declaration if present
  let cleanSvg = svg.replace(/<\?xml[^>]*\?>/gi, "").trim();

  // Apply size if specified
  if (size) {
    cleanSvg = applySizeToSvg(cleanSvg, size);
  }

  // Add inline styling class
  cleanSvg = cleanSvg.replace(
    "<svg",
    '<svg class="mdforge-icon" style="display:inline-block;vertical-align:middle"',
  );

  return cleanSvg;
}

/** Iconify ids are lowercase; the syntax is matched case-insensitively. */
type IconId = { prefix: string; name: string; key: string };

function iconKey(prefix: string, name: string): IconId {
  const p = prefix.toLowerCase();
  const n = name.toLowerCase();

  return { prefix: p, name: n, key: `${p}:${n}` };
}

/**
 * Process icons in markdown content.
 * Fetches icons from the Iconify server and replaces :icon[prefix:name]
 * syntax with inline SVGs. Throws if `apiUrl` is not a valid server URL.
 */
export async function processIcons(content: string, options: IconOptions = {}): Promise<string> {
  const ids = new Map<string, IconId>();

  for (const match of content.matchAll(ICON_REGEX)) {
    const [, prefix, name] = match;

    if (prefix && name) {
      const id = iconKey(prefix, name);
      ids.set(id.key, id);
    }
  }

  if (ids.size === 0) {
    return content;
  }

  const base = iconifyBase(options.apiUrl ?? DEFAULT_ICONIFY_API);

  const source: IconSource = {
    base,
    cacheDir: join(
      options.cacheRoot ?? DEFAULT_CACHE_ROOT,
      createHash("sha256").update(base.href).digest("hex"),
    ),
    fetch: options.fetch ?? fetch,
  };

  const iconMap = new Map<string, string>();

  await Promise.all(
    [...ids].map(async ([key, { prefix, name }]) => {
      const svg = await fetchIcon(source, prefix, name);

      if (svg) {
        iconMap.set(key, svg);
      }
    }),
  );

  return content.replace(ICON_REGEX, (_match, prefix: string, name: string, sizeStr?: string) => {
    const id = iconKey(prefix, name);
    const svg = iconMap.get(id.key);

    if (!svg) {
      // Placeholder if the icon couldn't be fetched
      return `[icon:${id.prefix}:${id.name}]`;
    }

    const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined;

    return createInlineSvg(svg, size);
  });
}
