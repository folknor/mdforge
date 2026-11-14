/**
 * Font loading and pairings for mdforge
 *
 * Supports system fonts with Google Fonts fallbacks.
 * System fonts are used when available; fallbacks are downloaded from Google Fonts.
 */

import { getGoogleFontsCss, isSystemFont } from "./font-cache.ts";
import type { FontPairingPreset, Theme } from "./presets.ts";

export type { FontPairingPreset } from "./presets.ts";

export interface FontConfig {
  heading?: string;
  body?: string;
  mono?: string;
}

/**
 * Font pairing config with optional Google Fonts fallbacks
 */
export interface FontPairingConfig {
  heading?: string;
  headingFallback?: string; // Google Fonts fallback if heading not installed
  body?: string;
  bodyFallback?: string; // Google Fonts fallback if body not installed
  mono?: string;
  monoFallback?: string; // Google Fonts fallback if mono not installed
}

/**
 * Named font pairings (presets)
 *
 * Theme pairings use system fonts with Google Fonts fallbacks.
 * Named pairings (classic-elegant, etc.) use Google Fonts directly.
 *
 * The preset names are owned by the browser-safe list in presets.ts. This
 * table must define exactly those names, and every theme too, because
 * prepare.ts uses the theme name as the default preset.
 */
export const fontPairings = {
  // Theme-based pairings - system fonts with fallbacks
  beryl: {
    body: "Noto Sans",
    mono: "Fira Code",
  },
  tufte: {
    body: "Palatino Linotype",
    bodyFallback: "EB Garamond", // Classical Garamond, similar to Palatino
    mono: "Consolas",
    monoFallback: "Inconsolata", // Inspired by Consolas
  },
  buttondown: {
    heading: "Helvetica Neue",
    headingFallback: "Inter", // Modern Helvetica alternative
    body: "Georgia",
    bodyFallback: "Gelasio", // Metrically compatible with Georgia
    mono: "Courier New",
    monoFallback: "Fira Code",
  },
  pandoc: {
    body: "Georgia",
    bodyFallback: "Libre Baskerville", // Web-optimized serif like Georgia
    mono: "Consolas",
    monoFallback: "Fira Code",
  },

  // Google Fonts pairings - no fallbacks needed
  "modern-professional": {
    heading: "Inter",
    body: "Inter",
    mono: "Fira Code",
  },
  "classic-elegant": {
    heading: "Playfair Display",
    body: "Libre Baskerville",
    mono: "Fira Code",
  },
  "modern-geometric": {
    heading: "Poppins",
    body: "Open Sans",
    mono: "Fira Code",
  },
  "tech-minimal": {
    heading: "Space Grotesk",
    body: "DM Sans",
    mono: "JetBrains Mono",
  },
  editorial: {
    heading: "Cormorant Garamond",
    body: "Libre Baskerville",
    mono: "Fira Code",
  },
  "clean-sans": {
    heading: "DM Sans",
    body: "Inter",
    mono: "Fira Code",
  },
} satisfies Record<FontPairingPreset | Theme, FontPairingConfig>;

/**
 * Whether `name` is a font preset. An own-property check, so prototype names
 * such as "toString" are not presets.
 */
export function isFontPairingPreset(name: string): name is FontPairingPreset {
  return Object.hasOwn(fontPairings, name);
}

/** Info about how a font was resolved */
export interface FontResolutionInfo {
  name: string;
  source: "system" | "google" | "fallback-system" | "fallback-google";
  preferred?: string; // Original font if this is a fallback
}

/** Resolved fonts after checking system availability */
interface ResolvedFonts {
  heading?: string;
  body?: string;
  mono?: string;
  /** Fonts that need to be downloaded from Google Fonts */
  fontsToDownload: string[];
  /** Info about how each font was resolved */
  info: {
    heading?: FontResolutionInfo;
    body?: FontResolutionInfo;
    mono?: FontResolutionInfo;
  };
}

/**
 * Resolve font config - use system fonts when available, fallback to Google Fonts
 */
async function resolveFonts(config: FontPairingConfig): Promise<ResolvedFonts> {
  const result: ResolvedFonts = { fontsToDownload: [], info: {} };

  // Helper to resolve a single font
  async function resolveFont(
    preferred: string | undefined,
    fallback: string | undefined,
  ): Promise<{ name: string; info: FontResolutionInfo } | undefined> {
    if (!preferred) return;

    // Check if preferred font is installed locally
    if (await isSystemFont(preferred)) {
      return {
        name: preferred,
        info: { name: preferred, source: "system" },
      };
    }

    // Use fallback if available, otherwise try preferred from Google Fonts
    const fontToUse = fallback || preferred;
    const isFallback = fallback && fontToUse === fallback;

    // Check if fallback/font is a system font
    if (await isSystemFont(fontToUse)) {
      return {
        name: fontToUse,
        info: {
          name: fontToUse,
          source: isFallback ? "fallback-system" : "system",
          preferred: isFallback ? preferred : undefined,
        },
      };
    }

    // Need to download from Google Fonts
    if (!result.fontsToDownload.includes(fontToUse)) {
      result.fontsToDownload.push(fontToUse);
    }

    return {
      name: fontToUse,
      info: {
        name: fontToUse,
        source: isFallback ? "fallback-google" : "google",
        preferred: isFallback ? preferred : undefined,
      },
    };
  }

  const headingResult = await resolveFont(config.heading, config.headingFallback);

  const bodyResult = await resolveFont(config.body, config.bodyFallback);
  const monoResult = await resolveFont(config.mono, config.monoFallback);

  if (headingResult) {
    result.heading = headingResult.name;
    result.info.heading = headingResult.info;
  }

  if (bodyResult) {
    result.body = bodyResult.name;
    result.info.body = bodyResult.info;
  }

  if (monoResult) {
    result.mono = monoResult.name;
    result.info.mono = monoResult.info;
  }

  // Deduplicate fonts to download
  result.fontsToDownload = [...new Set(result.fontsToDownload)];

  return result;
}

/**
 * Generate CSS variables and rules for fonts
 */
function generateFontCss(fonts: ResolvedFonts): string {
  const lines: string[] = [];

  if (fonts.heading || fonts.body || fonts.mono) {
    lines.push(":root {");

    if (fonts.heading) {
      lines.push(`  --font-heading: "${fonts.heading}", system-ui, sans-serif;`);
    }

    if (fonts.body) {
      lines.push(`  --font-body: "${fonts.body}", system-ui, sans-serif;`);
    }

    if (fonts.mono) {
      lines.push(`  --font-mono: "${fonts.mono}", ui-monospace, monospace;`);
    }

    lines.push("}");
    lines.push("");
  }

  if (fonts.body) {
    lines.push("body {");
    lines.push("  font-family: var(--font-body);");
    lines.push("}");
    lines.push("");
  }

  if (fonts.heading) {
    lines.push("h1, h2, h3, h4, h5, h6 {");
    lines.push("  font-family: var(--font-heading);");
    lines.push("}");
    lines.push("");
  }

  if (fonts.mono) {
    lines.push("code, kbd, samp, pre {");
    lines.push("  font-family: var(--font-mono);");
    lines.push("}");
  }

  return lines.join("\n");
}

/** Embedded font data extracted from CSS */
export interface EmbeddedFontData {
  family: string;
  data: Uint8Array;
  weight: number;
  style: string;
}

/** Result of generating font stylesheet */
export interface FontStylesheetResult {
  css: string;
  info: {
    heading?: FontResolutionInfo;
    body?: FontResolutionInfo;
    mono?: FontResolutionInfo;
  };
  warnings: string[];
  /** Extracted font data for embedding in PDFs */
  embeddedFonts?: EmbeddedFontData[];
}

/**
 * Extract embedded font data from CSS @font-face rules
 */
function extractEmbeddedFonts(css: string): EmbeddedFontData[] {
  const fonts: EmbeddedFontData[] = [];

  // Match @font-face blocks using matchAll to avoid infinite loop issues with continue
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;

  for (const match of css.matchAll(fontFaceRegex)) {
    const block = match[1];

    if (!block) continue;

    // Extract font-family
    const familyMatch = block.match(/font-family:\s*['"]([^'"]+)['"]/);

    if (!familyMatch?.[1]) continue;
    const family = familyMatch[1];

    // Extract font-weight (default 400)
    const weightMatch = block.match(/font-weight:\s*(\d+)/);
    const weight = weightMatch?.[1] ? parseInt(weightMatch[1], 10) : 400;

    // Extract font-style (default normal)
    const styleMatch = block.match(/font-style:\s*(\w+)/);
    const style = styleMatch?.[1] || "normal";

    // Extract base64 woff2 data
    const dataMatch = block.match(/url\(data:font\/woff2;base64,([^)]+)\)/);

    if (!dataMatch?.[1]) continue;

    // Decode base64 to Uint8Array
    const base64 = dataMatch[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    fonts.push({ family, data: bytes, weight, style });
  }

  return fonts;
}

/**
 * Generate complete font CSS from config
 *
 * @param fontConfig - Fonts with optional fallbacks; preset names are resolved
 *   by the caller (see `isFontPairingPreset`)
 * @returns CSS with embedded fonts (cached locally) and resolution info
 */
export async function generateFontStylesheet(
  fontConfig?: FontPairingConfig,
): Promise<FontStylesheetResult | undefined> {
  if (!(fontConfig?.heading || fontConfig?.body || fontConfig?.mono)) return;

  const warnings: string[] = [];

  // Resolve fonts - checks system availability and determines what to download
  const resolved = await resolveFonts(fontConfig);

  // Get Google Fonts CSS for fonts that need downloading
  let googleFontsCss = "";

  if (resolved.fontsToDownload.length > 0) {
    const result = await getGoogleFontsCss(resolved.fontsToDownload);
    warnings.push(...result.warnings);

    if (result.css) {
      googleFontsCss = result.css;
    }
  }

  // Generate CSS variables and rules
  const cssRules = generateFontCss(resolved);

  const parts = ["/* mdforge font loading */"];

  if (googleFontsCss) parts.push(googleFontsCss);
  parts.push("", cssRules);

  // Extract embedded font data from Google Fonts CSS
  const embeddedFonts = googleFontsCss ? extractEmbeddedFonts(googleFontsCss) : [];

  return {
    css: parts.join("\n"),
    info: resolved.info,
    warnings,
    embeddedFonts,
  };
}
