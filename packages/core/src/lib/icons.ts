import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Iconify icon support for mdforge
 *
 * Syntax: :icon[prefix:name] or :icon[prefix:name]{size=24}
 * Example: :icon[mdi:home] or :icon[mdi:home]{size=32}
 */

const ICONIFY_API = "https://api.iconify.design";

// Cache directory for downloaded icons
const CACHE_DIR = join(homedir(), ".cache", "mdforge", "icons");

/**
 * Regex to match icon syntax:
 * :icon[prefix:name] or :icon[prefix:name]{size=24}
 */
const ICON_REGEX = /:icon\[([a-z0-9-]+):([a-z0-9-]+)\](?:\{size=(\d+)\})?/gi;

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
	await fs.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Get cache file path for an icon
 */
function getCachePath(prefix: string, name: string): string {
	return join(CACHE_DIR, `${prefix}--${name}.svg`);
}

/**
 * Check if icon is in cache and return it
 */
async function getFromCache(
	prefix: string,
	name: string,
): Promise<string | null> {
	const cachePath = getCachePath(prefix, name);
	try {
		const svg = await fs.readFile(cachePath, "utf-8");
		return svg;
	} catch {
		return null;
	}
}

/**
 * Save icon to cache
 */
async function saveToCache(
	prefix: string,
	name: string,
	svg: string,
): Promise<void> {
	await ensureCacheDir();
	const cachePath = getCachePath(prefix, name);
	await fs.writeFile(cachePath, svg, "utf-8");
}

/**
 * Fetch icon from Iconify API
 */
async function fetchIcon(prefix: string, name: string): Promise<string | null> {
	// Check cache first
	const cached = await getFromCache(prefix, name);
	if (cached) {
		return cached;
	}

	// Fetch from API
	const url = `${ICONIFY_API}/${prefix}/${name}.svg`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			console.warn(
				`Failed to fetch icon ${prefix}:${name}: ${response.status}`,
			);
			return null;
		}
		const svg = await response.text();

		// Validate it's actually SVG
		if (!svg.includes("<svg")) {
			console.warn(`Invalid SVG response for icon ${prefix}:${name}`);
			return null;
		}

		// Cache for future use
		await saveToCache(prefix, name, svg);

		return svg;
	} catch (error) {
		const err = error as Error;
		console.warn(`Error fetching icon ${prefix}:${name}: ${err.message}`);
		return null;
	}
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

/**
 * Find all icon references in content
 */
function findIconReferences(
	content: string,
): Array<{ prefix: string; name: string; size?: number; match: string }> {
	const refs: Array<{
		prefix: string;
		name: string;
		size?: number;
		match: string;
	}> = [];
	const seen = new Set<string>();

	let match: RegExpExecArray | null;
	// Reset regex lastIndex
	ICON_REGEX.lastIndex = 0;

	while ((match = ICON_REGEX.exec(content)) !== null) {
		const fullMatch = match[0];
		const prefix = match[1];
		const name = match[2];
		const sizeStr = match[3];

		if (!prefix || !name) continue;

		const key = `${prefix}:${name}`;

		if (!seen.has(key)) {
			seen.add(key);
			refs.push({
				prefix,
				name,
				size: sizeStr ? Number.parseInt(sizeStr, 10) : undefined,
				match: fullMatch,
			});
		}
	}

	return refs;
}

/**
 * Process icons in markdown content.
 * Fetches icons from Iconify API and replaces :icon[prefix:name] syntax with inline SVGs.
 */
export async function processIcons(content: string): Promise<string> {
	const refs = findIconReferences(content);

	if (refs.length === 0) {
		return content;
	}

	// Fetch all unique icons in parallel
	const iconMap = new Map<string, string>();

	await Promise.all(
		refs.map(async ({ prefix, name }) => {
			const key = `${prefix}:${name}`;
			if (!iconMap.has(key)) {
				const svg = await fetchIcon(prefix, name);
				if (svg) {
					iconMap.set(key, svg);
				}
			}
		}),
	);

	// Replace all icon references with inline SVGs
	// Reset regex for replacement pass
	ICON_REGEX.lastIndex = 0;

	return content.replace(ICON_REGEX, (_match, prefix, name, sizeStr) => {
		const key = `${prefix}:${name}`;
		const svg = iconMap.get(key);

		if (!svg) {
			// Return placeholder if icon couldn't be fetched
			return `[icon:${prefix}:${name}]`;
		}

		const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined;
		return createInlineSvg(svg, size);
	});
}

/**
 * Clear the icon cache
 */
export async function clearIconCache(): Promise<void> {
	try {
		await fs.rm(CACHE_DIR, { recursive: true, force: true });
	} catch {
		// Ignore errors
	}
}
