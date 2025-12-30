import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFonts } from "font-list";

/**
 * Google Fonts caching for mdforge
 *
 * Checks system fonts first, downloads from Google Fonts only if needed.
 * Downloaded fonts are cached in ~/.cache/mdforge/fonts/
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(homedir(), ".cache", "mdforge", "fonts");
const GOOGLE_FONTS_LIST = join(__dirname, "..", "data", "google-fonts.json");

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
		systemFontsCache = new Set(
			fonts.map((f) => f.replace(/^["']|["']$/g, "").toLowerCase()),
		);
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

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
	await fs.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Generate cache key for a font request
 */
function getCacheKey(fontNames: string[], weights: number[]): string {
	const input = fontNames.sort().join(",") + ":" + weights.sort().join(",");
	return createHash("md5").update(input).digest("hex");
}

/**
 * Get cached CSS if available
 */
async function getCachedCss(cacheKey: string): Promise<string | null> {
	const cssPath = join(CACHE_DIR, `${cacheKey}.css`);
	try {
		return await fs.readFile(cssPath, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Save CSS to cache
 */
async function saveCachedCss(cacheKey: string, css: string): Promise<void> {
	await ensureCacheDir();
	const cssPath = join(CACHE_DIR, `${cacheKey}.css`);
	await fs.writeFile(cssPath, css, "utf-8");
}

/** Result of font fetch with possible warnings */
export interface FontFetchResult {
	css: string | null;
	warnings: string[];
}

/**
 * Download a font file and return as base64
 */
async function downloadFontAsBase64(url: string): Promise<string | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			return null;
		}

		const buffer = await response.arrayBuffer();
		return Buffer.from(buffer).toString("base64");
	} catch {
		return null;
	}
}

/**
 * Fetch Google Fonts CSS and convert to self-contained CSS with embedded fonts
 */
async function fetchAndEmbedFonts(
	fontNames: string[],
	weights: number[],
): Promise<FontFetchResult> {
	const warnings: string[] = [];

	// Build Google Fonts URL
	const families = fontNames
		.map((name) => {
			const encoded = name.replace(/ /g, "+");
			return `family=${encoded}:wght@${weights.join(";")}`;
		})
		.join("&");

	const url = `https://fonts.googleapis.com/css2?${families}&display=swap`;

	try {
		// Fetch CSS (need user agent to get woff2)
		const response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
		});

		if (!response.ok) {
			warnings.push(`Failed to fetch fonts "${fontNames.join(", ")}" from Google Fonts: ${response.status} ${response.statusText}`);
			return { css: null, warnings };
		}

		let css = await response.text();

		// Find all woff2 URLs and replace with base64
		const urlRegex = /url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/g;
		const urls = new Set<string>();
		let match: RegExpExecArray | null;

		while ((match = urlRegex.exec(css)) !== null) {
			if (match[1]) urls.add(match[1]);
		}

		// Download all fonts in parallel
		const fontMap = new Map<string, string>();
		await Promise.all(
			Array.from(urls).map(async (fontUrl) => {
				const base64 = await downloadFontAsBase64(fontUrl);
				if (base64) {
					fontMap.set(fontUrl, base64);
				}
			}),
		);

		// Replace URLs with base64 data URIs
		for (const [fontUrl, base64] of fontMap) {
			css = css.replace(
				`url(${fontUrl})`,
				`url(data:font/woff2;base64,${base64})`,
			);
		}

		return { css, warnings };
	} catch (error) {
		const err = error as Error;
		warnings.push(`Failed to fetch fonts "${fontNames.join(", ")}" from Google Fonts: ${err.message}`);
		return { css: null, warnings };
	}
}

/**
 * Get font CSS - uses system fonts when available, downloads from Google Fonts otherwise
 *
 * Returns CSS with @font-face rules and any warnings.
 * System fonts are referenced by name, downloaded fonts are embedded as base64.
 */
export async function getGoogleFontsCss(
	fontNames: string[],
	weights: number[] = [400, 500, 600, 700],
): Promise<FontFetchResult> {
	if (fontNames.length === 0) return { css: null, warnings: [] };

	const warnings: string[] = [];

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
		const cacheKey = getCacheKey(fontsToDownload, weights);

		// Check cache first
		let downloadedCss = await getCachedCss(cacheKey);

		if (!downloadedCss) {
			// Fetch and embed fonts
			const result = await fetchAndEmbedFonts(fontsToDownload, weights);
			warnings.push(...result.warnings);
			downloadedCss = result.css;
			if (downloadedCss) {
				await saveCachedCss(cacheKey, downloadedCss);
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

/**
 * Clear the font cache
 */
export async function clearFontCache(): Promise<void> {
	try {
		await fs.rm(CACHE_DIR, { recursive: true, force: true });
	} catch {
		// Ignore errors
	}
}
