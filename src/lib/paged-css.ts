import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import type { HeaderFooterColumn, HeaderFooterValue } from "./config.js";

/**
 * MIME types for image embedding
 */
const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

/**
 * Format date with optional locale
 */
function formatDate(locale?: string): string {
	const date = new Date();
	try {
		return date.toLocaleDateString(locale, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch {
		return date.toLocaleDateString();
	}
}

/**
 * Convert image path to base64 data URI
 */
async function imageToDataUri(
	imagePath: string,
	baseDir: string,
): Promise<string | null> {
	try {
		const fullPath = resolve(baseDir, imagePath);
		const ext = extname(fullPath).toLowerCase();
		const mimeType = MIME_TYPES[ext];
		if (!mimeType) return null;

		const imageData = await fs.readFile(fullPath);
		const base64 = imageData.toString("base64");
		return `data:${mimeType};base64,${base64}`;
	} catch {
		return null;
	}
}

/**
 * Process markdown image syntax and convert to data URI
 */
async function processImages(
	text: string,
	baseDir: string,
): Promise<string> {
	const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
	let result = text;
	let match: RegExpExecArray | null;

	while ((match = imgRegex.exec(text)) !== null) {
		const [fullMatch, , src] = match;
		if (!src || src.startsWith("data:") || src.startsWith("http")) continue;

		const dataUri = await imageToDataUri(src, baseDir);
		if (dataUri) {
			// Replace markdown image with just the data URI (for CSS content)
			result = result.replace(fullMatch, `url("${dataUri}")`);
		}
	}

	return result;
}

/**
 * Convert our variable syntax to CSS content syntax
 */
function variablesToCss(text: string): string {
	return text
		// Date with locale: {date:nb-NO} -> pre-formatted string
		.replace(/\{date:([^}]+)\}/g, (_, locale) => `"${formatDate(locale)}"`)
		// Standard date -> pre-formatted with default locale
		.replace(/\{date\}/g, `"${formatDate()}"`)
		// Page counters
		.replace(/\{page\}/g, '" counter(page) "')
		.replace(/\{pages\}/g, '" counter(pages) "')
		// Title and chapter use string-set
		.replace(/\{title\}/g, '" string(doctitle) "')
		.replace(/\{chapter\}/g, '" string(chaptertitle) "')
		// URL
		.replace(/\{url\}/g, '" string(docurl) "');
}

/**
 * Process inline markdown (bold, italic) to CSS-safe text
 * Note: CSS content can't mix styles, so we strip markdown
 */
function processMarkdown(text: string): string {
	// For now, strip markdown since CSS content can't handle mixed styles
	// Could enhance later to detect single-style content
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
		.replace(/\*([^*]+)\*/g, "$1") // *italic* -> italic
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) -> text
}

/**
 * Build CSS content value from text
 */
async function buildContentValue(
	text: string,
	baseDir: string,
): Promise<string> {
	// Process images first (converts ![](path) to url("data:..."))
	let processed = await processImages(text, baseDir);

	// Process markdown (strip for now)
	processed = processMarkdown(processed);

	// Convert variables to CSS syntax
	processed = variablesToCss(processed);

	// If it contains url() from image processing, handle specially
	if (processed.includes('url("data:')) {
		// Content with image: url("data:...") " text"
		return processed;
	}

	// If the entire string is already a single quoted value (from date), return as-is
	// Date values look like "December 30, 2025" - no leading/trailing spaces inside quotes
	// Variable replacements look like " counter(page) " - with leading/trailing spaces
	if (/^"[^ ][^"]*[^ ]"$/.test(processed) || /^"[^"]{1}"$/.test(processed)) {
		return processed;
	}

	// Wrap in quotes for CSS content, clean up empty quotes
	return `"${processed}"`
		.replace(/"" /g, "")
		.replace(/ ""/g, "")
		.replace(/^""$/, '""');
}

/**
 * Normalize header/footer value to column format
 */
function normalizeToColumns(
	value: HeaderFooterValue | undefined,
): HeaderFooterColumn {
	if (!value) return {};
	if (typeof value === "string") {
		return { center: value };
	}
	return value;
}

/**
 * Configuration for paged CSS generation
 */
export interface PagedCssConfig {
	header?: HeaderFooterValue;
	footer?: HeaderFooterValue;
	firstPageHeader?: boolean; // default true
	firstPageFooter?: boolean; // default true
	// Future: mirrorMargins, etc.
}

/**
 * Generate CSS @page rules from simplified config
 */
export async function generatePagedCss(
	config: PagedCssConfig,
	themeCss: string,
	baseDir: string,
): Promise<string> {
	const header = normalizeToColumns(config.header);
	const footer = normalizeToColumns(config.footer);

	const marginRules: string[] = [];

	// Header positions
	if (header.left) {
		const content = await buildContentValue(header.left, baseDir);
		marginRules.push(`@top-left { content: ${content}; }`);
	}
	if (header.center) {
		const content = await buildContentValue(header.center, baseDir);
		marginRules.push(`@top-center { content: ${content}; }`);
	}
	if (header.right) {
		const content = await buildContentValue(header.right, baseDir);
		marginRules.push(`@top-right { content: ${content}; }`);
	}

	// Footer positions
	if (footer.left) {
		const content = await buildContentValue(footer.left, baseDir);
		marginRules.push(`@bottom-left { content: ${content}; }`);
	}
	if (footer.center) {
		const content = await buildContentValue(footer.center, baseDir);
		marginRules.push(`@bottom-center { content: ${content}; }`);
	}
	if (footer.right) {
		const content = await buildContentValue(footer.right, baseDir);
		marginRules.push(`@bottom-right { content: ${content}; }`);
	}

	// Build the CSS
	const css = `
/* Theme CSS */
${themeCss}

/* String-set for running headers */
h1 { string-set: doctitle content(text); }
h2 { string-set: chaptertitle content(text); }

/* Page setup */
@page {
  size: A4;
  margin: 25mm 20mm;

  ${marginRules.join("\n  ")}
}

/* First page exceptions */
${config.firstPageHeader === false ? `
@page:first {
  @top-left { content: none; }
  @top-center { content: none; }
  @top-right { content: none; }
}` : ""}

${config.firstPageFooter === false ? `
@page:first {
  @bottom-left { content: none; }
  @bottom-center { content: none; }
  @bottom-right { content: none; }
}` : ""}

/* Margin box styling */
@page {
  @top-left, @top-center, @top-right,
  @bottom-left, @bottom-center, @bottom-right {
    font-family: var(--font-body, system-ui, sans-serif);
    font-size: calc(var(--font-size, 12pt) * 0.7);
    color: var(--color-text, #333);
  }
}
`;

	return css;
}
