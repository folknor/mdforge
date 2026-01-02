import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import type {
	HeaderFooterColumn,
	HeaderFooterValue,
	PageNumberFormat,
	PageNumbersConfig,
} from "./config.js";

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
 * Scale an SVG by adding width attribute to the root svg element
 */
function scaleSvg(svgContent: string, scalePercent: number): string {
	// Calculate scaled width (relative to a base size of ~60px for header/footer context)
	const baseSize = 60;
	const scaledWidth = Math.round(baseSize * (scalePercent / 100));

	// Check if <svg has a width attribute already
	const svgTagMatch = svgContent.match(/<svg[^>]*>/);
	if (!svgTagMatch) return svgContent;

	const svgTag = svgTagMatch[0];
	if (svgTag.includes("width=")) {
		// Replace existing width on svg element only
		const newSvgTag = svgTag.replace(/width="[^"]*"/, `width="${scaledWidth}"`);
		return svgContent.replace(svgTag, newSvgTag);
	}
	// Add width to svg element
	return svgContent.replace("<svg", `<svg width="${scaledWidth}"`);
}

/**
 * Process image references and convert to data URI
 * Supports: "logo.svg" or "logo.svg 80%"
 */
async function processImages(text: string, baseDir: string): Promise<string> {
	// Match: filename.ext optionally followed by NN%
	// Also support markdown syntax: ![alt](src) NN%
	const patterns = [
		/!\[([^\]]*)\]\(([^)]+)\)(?:\s*(\d+)%)?/g, // ![alt](src) 80%
		/([a-zA-Z0-9_\-./]+\.(?:svg|png|jpg|jpeg|gif|webp))(?:\s+(\d+)%)?/gi, // file.svg 80%
	];

	let result = text;

	for (const regex of patterns) {
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text))) {
			// Extract src and size based on pattern
			let src: string | undefined;
			let sizePercent: string | undefined;

			if (match[0].startsWith("![")) {
				// Markdown syntax: ![alt](src) NN%
				src = match[2];
				sizePercent = match[3];
			} else {
				// Simple syntax: file.svg NN%
				src = match[1];
				sizePercent = match[2];
			}

			if (!src || src.startsWith("data:") || src.startsWith("http")) continue;

			const fullPath = resolve(baseDir, src);
			const ext = extname(fullPath).toLowerCase();
			const mimeType = MIME_TYPES[ext];
			if (!mimeType) continue;

			try {
				let imageData = await fs.readFile(fullPath);

				// For SVG with size specified, scale it
				if (ext === ".svg" && sizePercent) {
					let svgContent = imageData.toString("utf-8");
					svgContent = scaleSvg(svgContent, Number.parseInt(sizePercent, 10));
					imageData = Buffer.from(svgContent, "utf-8");
				}

				const base64 = imageData.toString("base64");
				const dataUri = `data:${mimeType};base64,${base64}`;
				result = result.replace(match[0], `url("${dataUri}")`);
			} catch {
				// File not found, skip
			}
		}
	}

	return result;
}

/**
 * Map page number format to CSS counter style
 */
function formatToCssCounterStyle(format?: PageNumberFormat): string {
	switch (format) {
		case "roman":
			return "lower-roman";
		case "roman-upper":
			return "upper-roman";
		case "alpha":
			return "lower-alpha";
		case "alpha-upper":
			return "upper-alpha";
		default:
			return "decimal";
	}
}

/**
 * Convert our variable syntax to CSS content syntax
 */
function variablesToCss(text: string, pageFormat?: PageNumberFormat): string {
	const counterStyle = formatToCssCounterStyle(pageFormat);
	const pageCounter =
		counterStyle === "decimal"
			? "counter(page)"
			: `counter(page, ${counterStyle})`;
	const pagesCounter =
		counterStyle === "decimal"
			? "counter(pages)"
			: `counter(pages, ${counterStyle})`;

	return (
		text
			// Date with locale: {date:nb-NO} -> pre-formatted string
			.replace(/\{date:([^}]+)\}/g, (_, locale) => `"${formatDate(locale)}"`)
			// Standard date -> pre-formatted with default locale
			.replace(/\{date\}/g, `"${formatDate()}"`)
			// Page counters with format
			.replace(/\{page\}/g, `" ${pageCounter} "`)
			.replace(/\{pages\}/g, `" ${pagesCounter} "`)
			// Title uses CSS variable (injected at build time from first h1)
			.replace(/\{title\}/g, '" var(--doc-title) "')
	);
}

/**
 * Process inline markdown (bold, italic) to CSS-safe text
 * Returns the text and any detected styles
 */
function processMarkdown(text: string): { text: string; styles: string[] } {
	const styles: string[] = [];
	const processed = text;

	// Check if entire content is bold: **text**
	const boldMatch = processed.match(/^\*\*([^*]+)\*\*$/);
	if (boldMatch?.[1]) {
		styles.push("font-weight: bold");
		return { text: boldMatch[1], styles };
	}

	// Check if entire content is italic: *text*
	const italicMatch = processed.match(/^\*([^*]+)\*$/);
	if (italicMatch?.[1]) {
		styles.push("font-style: italic");
		return { text: italicMatch[1], styles };
	}

	// Mixed or no markdown - strip it
	const stripped = processed
		.replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
		.replace(/\*([^*]+)\*/g, "$1") // *italic* -> italic
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) -> text

	return { text: stripped, styles };
}

interface ContentResult {
	content: string;
	styles: string[];
}

/**
 * Build CSS content value from text
 */
async function buildContentValue(
	text: string,
	baseDir: string,
	pageFormat?: PageNumberFormat,
): Promise<ContentResult> {
	// Process images first (converts ![](path) to url("data:..."))
	let processed = await processImages(text, baseDir);

	// Process markdown and extract styles
	const { text: mdProcessed, styles } = processMarkdown(processed);
	processed = mdProcessed;

	// Convert variables to CSS syntax
	processed = variablesToCss(processed, pageFormat);

	// If it contains url() from image processing, handle specially
	if (processed.includes('url("data:')) {
		// Content with image: url("data:...") " text"
		return { content: processed, styles };
	}

	// If the entire string is already a single quoted value (from date), return as-is
	// Date values look like "December 30, 2025" - no leading/trailing spaces inside quotes
	// Variable replacements look like " counter(page) " - with leading/trailing spaces
	if (/^"[^ ][^"]*[^ ]"$/.test(processed) || /^"[^"]{1}"$/.test(processed)) {
		return { content: processed, styles };
	}

	// Wrap in quotes for CSS content, clean up empty quotes
	const content = `"${processed}"`
		.replace(/"" /g, "")
		.replace(/ ""/g, "")
		.replace(/^""$/, '""');

	return { content, styles };
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
	page_numbers?: PageNumbersConfig;
	/** Document title for {title} variable */
	title?: string;
}

/**
 * Check if header/footer config uses background images
 * (requires Puppeteer templates instead of paged.js)
 */
export function hasBackground(config: PagedCssConfig): boolean {
	const header = normalizeToColumns(config.header);
	const footer = normalizeToColumns(config.footer);
	return !!(header.background || footer.background);
}

/**
 * Build a Puppeteer header/footer template HTML
 */
export async function buildPuppeteerTemplate(
	value: HeaderFooterValue | undefined,
	type: "header" | "footer",
	baseDir: string,
): Promise<string> {
	const columns = normalizeToColumns(value);

	// Build content for each column
	const left = columns.left ? processTextForHtml(columns.left) : "";
	const center = columns.center ? processTextForHtml(columns.center) : "";
	const right = columns.right ? processTextForHtml(columns.right) : "";

	// Build background CSS if specified
	let backgroundCss = "";
	if (columns.background) {
		const dataUri = await imageToDataUri(columns.background, baseDir);
		if (dataUri) {
			// Header backgrounds anchor to bottom, footer to top
			const position = type === "header" ? "bottom" : "top";
			backgroundCss = `
				background-image: url('${dataUri}');
				background-size: cover;
				background-repeat: no-repeat;
				background-position: ${position};
				background-origin: border-box;
			`;
		}
	}

	// IMPORTANT: Use unique class names for header vs footer templates.
	// Puppeteer appears to cache/conflate CSS when both templates use the same
	// class name, causing both header and footer to render the same background.
	// Using unique class names (hf-header-container vs hf-footer-container) fixes this.
	const containerClass = `hf-${type}-container`;

	return `<html>
<head>
	<style type="text/css">
		#header, #footer { padding: 0 !important; }
		.${containerClass} {
			width: 100%;
			padding: 12px 24px;
			-webkit-print-color-adjust: exact;
			display: flex;
			justify-content: space-between;
			align-items: center;
			font-family: Georgia, serif;
			font-size: 10px;
			line-height: 1.2;
			color: #333;
			min-height: 24px;
			${backgroundCss}
		}
		.hf-left { text-align: left; flex: 1; }
		.hf-center { text-align: center; flex: 1; }
		.hf-right { text-align: right; flex: 1; }
	</style>
</head>
<body>
	<div class="${containerClass}">
		<span class="hf-left">${left}</span>
		<span class="hf-center">${center}</span>
		<span class="hf-right">${right}</span>
	</div>
</body>
</html>`;
}

/**
 * Process text for HTML template (variables and markdown)
 */
function processTextForHtml(text: string): string {
	return (
		text
			// Page variables → Puppeteer special classes
			.replace(/\{page\}/g, '<span class="pageNumber"></span>')
			.replace(/\{pages\}/g, '<span class="totalPages"></span>')
			// Date → current date string
			.replace(/\{date:([^}]+)\}/g, (_, locale) => formatDate(locale))
			.replace(/\{date\}/g, formatDate())
			// Title/URL → Puppeteer special classes
			.replace(/\{title\}/g, '<span class="title"></span>')
			.replace(/\{url\}/g, '<span class="url"></span>')
			// Simple markdown
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/\*([^*]+)\*/g, "<em>$1</em>")
	);
}

/**
 * Transform simple CSS selectors to paged.js margin box selectors
 * .header-left { color: red } → .pagedjs_page .pagedjs_margin-top-left { color: red }
 */
function transformCssSelectors(css: string): string {
	const selectorMap: Record<string, string> = {
		".header-left": ".pagedjs_page .pagedjs_margin-top-left",
		".header-center": ".pagedjs_page .pagedjs_margin-top-center",
		".header-right": ".pagedjs_page .pagedjs_margin-top-right",
		".footer-left": ".pagedjs_page .pagedjs_margin-bottom-left",
		".footer-center": ".pagedjs_page .pagedjs_margin-bottom-center",
		".footer-right": ".pagedjs_page .pagedjs_margin-bottom-right",
	};

	let transformed = css;
	for (const [selector, pagedSelector] of Object.entries(selectorMap)) {
		// Match: .header-left { ... }
		const regex = new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`, "g");
		transformed = transformed.replace(regex, (_, content) => {
			return `${pagedSelector} {${content}}`;
		});
	}
	return transformed;
}

/**
 * Generate CSS @page rules from simplified config
 */
export async function generatePagedCss(
	config: PagedCssConfig,
	themeCss: string,
	baseDir: string,
): Promise<string> {
	// Transform simple selectors to @page rules
	const processedCss = transformCssSelectors(themeCss);

	const header = normalizeToColumns(config.header);
	const footer = normalizeToColumns(config.footer);
	const pageFormat = config.page_numbers?.format;
	const pageStart = config.page_numbers?.start;

	const marginRules: string[] = [];

	// Helper to build margin rule with optional extra styles
	const addMarginRule = async (position: string, text: string) => {
		const { content, styles } = await buildContentValue(
			text,
			baseDir,
			pageFormat,
		);
		const extraStyles = styles.length > 0 ? `${styles.join("; ")}; ` : "";
		marginRules.push(`@${position} { ${extraStyles}content: ${content}; }`);
	};

	// Header positions
	if (header.left) await addMarginRule("top-left", header.left);
	if (header.center) await addMarginRule("top-center", header.center);
	if (header.right) await addMarginRule("top-right", header.right);

	// Footer positions
	if (footer.left) await addMarginRule("bottom-left", footer.left);
	if (footer.center) await addMarginRule("bottom-center", footer.center);
	if (footer.right) await addMarginRule("bottom-right", footer.right);

	// Common margin box styling
	const marginStyle = `
    font-family: var(--font-body, system-ui, sans-serif);
    font-size: calc(var(--font-size, 12pt) * 0.7);
    color: var(--color-text, #333);`;

	// Add styling to each margin rule
	const styledMarginRules = marginRules.map((rule) =>
		rule.replace("{ content:", `{${marginStyle}\n    content:`),
	);

	// Counter reset for custom start value (subtract 1 because counter increments before first page)
	const counterReset =
		pageStart !== undefined && pageStart !== 1
			? `\n  counter-reset: page ${pageStart - 1};`
			: "";

	// Escape title for CSS string
	const escapedTitle = config.title
		? config.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
		: "";

	// Build the CSS
	const css = `
/* Theme CSS */
${processedCss}

/* Document variables for header/footer content */
:root {
  --doc-title: "${escapedTitle}";
}

/* Page setup */
@page {
  size: A4;
  margin: 25mm 20mm;${counterReset}

  ${styledMarginRules.join("\n  ")}
}

/* First page exceptions */
${
	header.firstPage === false
		? `
@page:first {
  @top-left { content: none; }
  @top-center { content: none; }
  @top-right { content: none; }
}`
		: ""
}

${
	footer.firstPage === false
		? `
@page:first {
  @bottom-left { content: none; }
  @bottom-center { content: none; }
  @bottom-right { content: none; }
}`
		: ""
}
`;

	return css;
}
