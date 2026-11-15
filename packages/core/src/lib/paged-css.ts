import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import type { HeaderFooterColumn, PageNumberFormat, PageNumbersConfig } from "./config.ts";

/**
 * MIME types for image embedding
 */
const MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

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
async function imageToDataUri(imagePath: string, baseDir: string): Promise<string | null> {
  try {
    const fullPath = resolve(baseDir, imagePath);
    const ext = extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES.get(ext);

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
 * A CSS string holding `text` exactly, serialised as CSSOM does (`"` and `\`
 * escaped, control characters as hex escapes, NUL as U+FFFD), with `<` also
 * escaped so the string can never contain `</style` (the generated sheet sits
 * in a `<style>` element).
 */
export function cssString(text: string): string {
  let out = '"';

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (code === 0) out += String.fromCodePoint(0xfffd);
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else if (char === '"' || char === "\\") out += `\\${char}`;
    else if (char === "<") out += "\\3c ";
    else out += char;
  }

  return `${out}"`;
}

/** Header/footer text split into text and embedded images. */
type ContentPart = { kind: "text"; text: string } | { kind: "image"; uri: string };

/** `![alt](src) 80%` or `file.svg 80%` */
const IMAGE_REFERENCE =
  /!\[[^\]]*\]\(([^)]+)\)(?:\s*(\d+)%)?|([a-zA-Z0-9_\-./]+\.(?:svg|png|jpg|jpeg|gif|webp))(?:\s+(\d+)%)?/gi;

/** An image reference's data URI, or undefined when it cannot be read. */
async function imageReferenceUri(
  src: string,
  sizePercent: string | undefined,
  baseDir: string,
): Promise<string | undefined> {
  if (src.startsWith("data:") || src.startsWith("http")) return undefined;

  const fullPath = resolve(baseDir, src);
  const ext = extname(fullPath).toLowerCase();
  const mimeType = MIME_TYPES.get(ext);

  if (!mimeType) return undefined;

  try {
    let imageData = await fs.readFile(fullPath);

    // For SVG with size specified, scale it
    if (ext === ".svg" && sizePercent) {
      const svgContent = scaleSvg(imageData.toString("utf-8"), Number.parseInt(sizePercent, 10));
      imageData = Buffer.from(svgContent, "utf-8");
    }

    return `data:${mimeType};base64,${imageData.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Split text at its image references ("logo.svg", "logo.svg 80%",
 * "![alt](src) 80%"). Only a reference whose file was read becomes an image;
 * anything else, `url(...)` written by hand included, stays text.
 */
async function imageParts(text: string, baseDir: string): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  let at = 0;

  for (const match of text.matchAll(IMAGE_REFERENCE)) {
    const src = match[1] ?? match[3] ?? "";
    const uri = await imageReferenceUri(src, match[2] ?? match[4], baseDir);

    if (uri === undefined) continue;

    parts.push({ kind: "text", text: text.slice(at, match.index) }, { kind: "image", uri });
    at = match.index + match[0].length;
  }

  parts.push({ kind: "text", text: text.slice(at) });

  return parts;
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
 * CSS `content` values for text with our variables: `{page}` and `{pages}`
 * become counters, `{title}` the `--doc-title` variable, `{date}` and
 * `{date:locale}` today's date as text; all other text becomes CSS strings.
 */
function variableValues(text: string, pageFormat?: PageNumberFormat): string[] {
  const counterStyle = formatToCssCounterStyle(pageFormat);

  const counter = (name: string) =>
    counterStyle === "decimal" ? `counter(${name})` : `counter(${name}, ${counterStyle})`;

  const values: string[] = [];
  let pending = "";
  let at = 0;

  for (const match of text.matchAll(/\{(page|pages|title|date)(?::([^}]+))?\}/g)) {
    const [whole, name, locale] = match;
    pending += text.slice(at, match.index);
    at = match.index + whole.length;

    if (name === "date") {
      pending += formatDate(locale);
      continue;
    }

    // `{page:x}` is not a variable
    if (locale !== undefined) {
      pending += whole;
      continue;
    }

    if (pending) values.push(cssString(pending));
    pending = "";
    values.push(name === "title" ? "var(--doc-title)" : counter(name ?? "page"));
  }

  pending += text.slice(at);

  if (pending) values.push(cssString(pending));

  return values;
}

/** Text with whole-text emphasis removed, plus the CSS that replaces it. */
interface MarkdownResult {
  text: string;
  styles: string[];
}

/** Bold or italic covering the whole text becomes a style. */
function wholeEmphasis(text: string): MarkdownResult {
  const bold = text.match(/^\*\*([^*]+)\*\*$/)?.[1];

  if (bold) return { text: bold, styles: ["font-weight: bold"] };

  const italic = text.match(/^\*([^*]+)\*$/)?.[1];

  if (italic) return { text: italic, styles: ["font-style: italic"] };

  return { text, styles: [] };
}

/** Mixed inline markdown is stripped: margin boxes hold plain text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
    .replace(/\*([^*]+)\*/g, "$1") // *italic* -> italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) -> text
}

interface ContentResult {
  content: string;
  styles: string[];
}

/**
 * The CSS `content` value for a header/footer column. It is built from parts
 * (strings, images, counters, the title variable), each serialised on its
 * own, so no text of the column can end the string it sits in or the
 * `<style>` element the sheet goes in.
 */
async function buildContentValue(
  text: string,
  baseDir: string,
  pageFormat?: PageNumberFormat,
): Promise<ContentResult> {
  const { text: inner, styles } = wholeEmphasis(text);

  const values = (await imageParts(inner, baseDir)).flatMap((part) =>
    part.kind === "image"
      ? [`url(${cssString(part.uri)})`]
      : variableValues(stripMarkdown(part.text), pageFormat),
  );

  return { content: values.length > 0 ? values.join(" ") : '""', styles };
}

/**
 * Whether a header or footer shows anything. One with no non-empty column and
 * no background (e.g. `header: ""` overriding an inherited one) is inactive:
 * it neither switches on the header/footer layout nor replaces a raw
 * `pdf_options` template.
 */
export function hasContent(columns: HeaderFooterColumn | undefined): boolean {
  return Boolean(columns?.left || columns?.center || columns?.right || columns?.background);
}

/**
 * Configuration for paged CSS generation
 */
export interface PagedCssConfig {
  header?: HeaderFooterColumn;
  footer?: HeaderFooterColumn;
  page_numbers?: PageNumbersConfig;
  /** Document title for {title} variable */
  title?: string;
}

/**
 * Check if header/footer config uses background images
 * (requires Puppeteer templates instead of paged.js)
 */
export function hasBackground(config: PagedCssConfig): boolean {
  return Boolean(config.header?.background || config.footer?.background);
}

/**
 * Build a Puppeteer header/footer template HTML
 */
export async function buildPuppeteerTemplate(
  columns: HeaderFooterColumn,
  type: "header" | "footer",
  baseDir: string,
): Promise<string> {
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
 * Generate CSS @page rules from simplified config. The document's stylesheets
 * are not read or copied here: a copy would come later in the cascade than
 * the sheets it was taken from and resolve their relative `url()` and
 * `@import` against the document instead of each sheet's own directory.
 * Element selectors such as `.header-left` cannot reach margin boxes; users
 * style them with `@page { @top-left { ... } }`, which prepare.ts makes win by
 * placing this sheet before the user's stylesheets.
 */
export async function generatePagedCss(config: PagedCssConfig, baseDir: string): Promise<string> {
  const header = config.header ?? {};
  const footer = config.footer ?? {};
  const pageFormat = config.page_numbers?.format;
  const pageStart = config.page_numbers?.start;

  const marginRules: string[] = [];

  // Common margin box styling, then the column's own markdown styles, then
  // its content, all built as one declaration list.
  const marginStyle = [
    "font-family: var(--font-body, system-ui, sans-serif)",
    "font-size: calc(var(--font-size, 12pt) * 0.7)",
    "color: var(--color-text, #333)",
  ];

  const addMarginRule = async (position: string, text: string): Promise<void> => {
    const { content, styles } = await buildContentValue(text, baseDir, pageFormat);

    const declarations = [...marginStyle, ...styles, `content: ${content}`];
    marginRules.push(`@${position} {\n    ${declarations.join(";\n    ")};\n  }`);
  };

  // Header positions
  if (header.left) await addMarginRule("top-left", header.left);

  if (header.center) await addMarginRule("top-center", header.center);

  if (header.right) await addMarginRule("top-right", header.right);

  // Footer positions
  if (footer.left) await addMarginRule("bottom-left", footer.left);

  if (footer.center) await addMarginRule("bottom-center", footer.center);

  if (footer.right) await addMarginRule("bottom-right", footer.right);

  // Counter reset for custom start value (subtract 1 because counter increments before first page)
  const counterReset =
    pageStart !== undefined && pageStart !== 1 ? `\n  counter-reset: page ${pageStart - 1};` : "";

  // Build the CSS
  const css = `
/* Document variables for header/footer content */
:root {
  --doc-title: ${cssString(config.title ?? "")};
}

/* Page setup */
@page {
  size: A4;
  margin: 25mm 20mm;${counterReset}

  ${marginRules.join("\n  ")}
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
