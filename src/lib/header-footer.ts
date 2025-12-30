import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import { Marked } from "marked";
import type { HeaderFooterValue } from "./config.js";

/**
 * Default CSS when no theme is available.
 */
const DEFAULT_CSS = `
:root {
	--font-body: system-ui, sans-serif;
	--font-size: 12pt;
	--color-text: #333;
}
`;

/**
 * MIME types for common image formats.
 */
const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".ico": "image/x-icon",
};

/**
 * Format date with optional locale.
 * Supports: {date} (browser default), {date:nb-NO} (Norwegian), etc.
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
 * Replace variable placeholders with Puppeteer's built-in class spans.
 */
function processPlaceholders(text: string): string {
	return text
		.replace(/\{page\}/g, '<span class="pageNumber"></span>')
		.replace(/\{pages\}/g, '<span class="totalPages"></span>')
		.replace(/\{date:([^}]+)\}/g, (_, locale) => formatDate(locale))
		.replace(/\{date\}/g, '<span class="date"></span>')
		.replace(/\{title\}/g, '<span class="title"></span>')
		.replace(/\{url\}/g, '<span class="url"></span>');
}

/**
 * Parse markdown content inline (without wrapping <p> tags).
 */
function parseMarkdownInline(text: string): string {
	const marked = new Marked();
	return marked.parseInline(text) as string;
}

/**
 * Convert local image src to data URI.
 */
async function embedImages(html: string, baseDir: string): Promise<string> {
	const imgRegex = /<img\s+[^>]*src="([^"]+)"[^>]*>/g;
	let match: RegExpExecArray | null;

	while ((match = imgRegex.exec(html)) !== null) {
		const fullMatch = match[0];
		const src = match[1];
		if (!src) continue;

		// Skip data URIs and http(s) URLs
		if (src.startsWith("data:") || src.startsWith("http")) continue;

		try {
			const imagePath = resolve(baseDir, src);
			const ext = extname(imagePath).toLowerCase();
			const mimeType = MIME_TYPES[ext];
			if (!mimeType) continue;

			const imageData = await fs.readFile(imagePath);
			const base64 = imageData.toString("base64");
			const dataUri = `data:${mimeType};base64,${base64}`;
			html = html.replace(fullMatch, fullMatch.replace(src, dataUri));
		} catch {
			// Image not found, leave as-is
		}
	}

	return html;
}

/**
 * Process content: markdown first, then placeholders.
 */
function processContent(text: string): string {
	return processPlaceholders(parseMarkdownInline(text));
}

/**
 * Convert simplified header/footer config to Puppeteer HTML template.
 * @param value - The header/footer config value
 * @param type - Either "header" or "footer"
 * @param themeCss - Full theme CSS content (or empty for defaults)
 * @param baseDir - Base directory for resolving relative image paths
 */
export async function buildHeaderFooterTemplate(
	value: HeaderFooterValue,
	type: "header" | "footer",
	themeCss: string,
	baseDir: string = process.cwd(),
): Promise<string> {
	// Normalize to three-column format
	let left = "";
	let center = "";
	let right = "";

	if (typeof value === "string") {
		center = processContent(value);
	} else {
		left = value.left ? processContent(value.left) : "";
		center = value.center ? processContent(value.center) : "";
		right = value.right ? processContent(value.right) : "";
	}

	const css = themeCss || DEFAULT_CSS;

	let html = `<html>
<head>
<style>
${css}
#header, #footer { padding: 0 !important; }
.hf {
	font-family: var(--font-body);
	font-size: calc(var(--font-size) * 0.7);
	color: var(--color-text);
	width: 100%;
	padding: 0 20px;
	box-sizing: border-box;
	-webkit-print-color-adjust: exact;
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.hf.header { padding-top: 10px; }
.hf.footer { padding-bottom: 10px; }
.hf-left { text-align: left; flex: 1; }
.hf-center { text-align: center; flex: 1; }
.hf-right { text-align: right; flex: 1; }
</style>
</head>
<body>
<div class="hf ${type}">
	<span class="hf-left">${left}</span>
	<span class="hf-center">${center}</span>
	<span class="hf-right">${right}</span>
</div>
</body>
</html>`;

	// Embed local images as data URIs
	html = await embedImages(html, baseDir);

	return html;
}
