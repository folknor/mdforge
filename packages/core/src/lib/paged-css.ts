import { promises as fs } from "node:fs";
import { extname, resolve } from "node:path";
import type { HeaderFooterColumn, PageNumberFormat, PageNumbersConfig } from "./config.ts";
import { escapeHtml } from "./util.ts";

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

/** Absolute SVG lengths in CSS pixels; relative lengths have no intrinsic ratio. */
function svgLength(value: string | undefined): number | undefined {
  const match = value
    ?.trim()
    .match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?$/i);

  if (!match) return undefined;

  const units = new Map([
    ["px", 1],
    ["in", 96],
    ["cm", 96 / 2.54],
    ["mm", 96 / 25.4],
    ["q", 96 / 101.6],
    ["pt", 96 / 72],
    ["pc", 16],
  ]);

  const length = Number(match[1]) * (units.get(match[2]?.toLowerCase() ?? "px") ?? 1);

  return Number.isFinite(length) && length > 0 ? length : undefined;
}

/** Scale the root viewport and its contents together, never retaining a tall height. */
function scaleSvg(svgContent: string, scalePercent: number): string {
  const root = svgContent.match(/<svg\b[^>]*>/);

  if (!root) return svgContent;
  const tag = root[0];

  const attribute = (name: string) =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "s"))?.[2];

  const viewBox = attribute("viewBox");

  const dimensions = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);

  const width = svgLength(attribute("width"));
  const height = svgLength(attribute("height"));

  // A viewBox supplies the ratio even with percentage/unit-bearing dimensions.
  // Without one, absolute dimensions supply both the ratio and the coordinate
  // system: adding a viewBox also scales artwork that otherwise would be clipped.
  const validViewBox =
    dimensions?.length === 4 &&
    dimensions.every(Number.isFinite) &&
    (dimensions[2] ?? 0) > 0 &&
    (dimensions[3] ?? 0) > 0;

  const ratio = validViewBox
    ? (dimensions[3] ?? 0) / (dimensions[2] ?? 1)
    : width && height
      ? height / width
      : undefined;

  const scaledWidth = Math.round((60 * scalePercent) / 100);
  let resized = tag.replace(/\s(?:width|height)\s*=\s*(["']).*?\1/gs, "");

  if (!viewBox && width && height)
    resized = resized.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
  // With no recoverable ratio (e.g. percentages without a viewBox), let SVG's
  // default sizing supply the height rather than preserving an unrelated one.
  resized = resized.replace(
    /<svg\b/,
    `<svg width="${scaledWidth}"${ratio === undefined ? "" : ` height="${scaledWidth * ratio}"`}`,
  );

  return svgContent.replace(tag, resized);
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

/**
 * One piece of a header/footer column. Both renderings (CSS margin boxes and
 * Chromium header/footer templates) are built from these, so a column means
 * the same thing in either; text is always shown as written.
 */
type ColumnPart =
  | { kind: "text"; text: string }
  | { kind: "image"; uri: string }
  | { kind: "page" }
  | { kind: "pages" }
  | { kind: "title" };

/** Text split at its embedded images, before variables are recognised. */
type ImagePart = { kind: "text"; text: string } | { kind: "image"; uri: string };

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
async function imageParts(text: string, baseDir: string): Promise<ImagePart[]> {
  const parts: ImagePart[] = [];
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
 * Text split at our variables: `{page}`, `{pages}` and `{title}` become their
 * parts, `{date}` and `{date:locale}` today's date as text. Anything else,
 * `{page:x}` and `{url}` included, stays text. Inserted values are never
 * scanned again.
 */
function variableParts(text: string): ColumnPart[] {
  const parts: ColumnPart[] = [];
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

    if (pending) parts.push({ kind: "text", text: pending });
    pending = "";
    parts.push({ kind: name === "title" ? "title" : name === "pages" ? "pages" : "page" });
  }

  pending += text.slice(at);

  if (pending) parts.push({ kind: "text", text: pending });

  return parts;
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

/** A column's parts plus the CSS declarations its whole-text emphasis became. */
interface ColumnContent {
  parts: ColumnPart[];
  styles: string[];
}

/**
 * Parse a header/footer column, the one place its text is interpreted:
 * whole-text emphasis becomes a style, then image references whose file is
 * read become images, then the remaining text has mixed markdown stripped and
 * its variables recognised.
 */
async function columnContent(text: string, baseDir: string): Promise<ColumnContent> {
  const { text: inner, styles } = wholeEmphasis(text);

  const parts = (await imageParts(inner, baseDir)).flatMap((part) =>
    part.kind === "image" ? [part] : variableParts(stripMarkdown(part.text)),
  );

  return { parts, styles };
}

interface ContentResult {
  content: string;
  styles: string[];
}

/**
 * The CSS `content` value for a header/footer column. Each part is serialised
 * on its own, so no text of the column can end the string it sits in or the
 * `<style>` element the sheet goes in.
 */
async function buildContentValue(
  text: string,
  baseDir: string,
  pageFormat?: PageNumberFormat,
): Promise<ContentResult> {
  const { parts, styles } = await columnContent(text, baseDir);
  const counterStyle = formatToCssCounterStyle(pageFormat);

  const counter = (name: string) =>
    counterStyle === "decimal" ? `counter(${name})` : `counter(${name}, ${counterStyle})`;

  const values = parts.map((part) => {
    switch (part.kind) {
      case "text":
        return cssString(part.text);
      case "image":
        return `url(${cssString(part.uri)})`;
      case "title":
        return "var(--doc-title)";
      default:
        return counter(part.kind);
    }
  });

  return { content: values.length > 0 ? values.join(" ") : '""', styles };
}

/**
 * The HTML for a header/footer column in a Chromium template. Text and the
 * document title are escaped, so they are shown as written.
 */
async function buildColumnHtml(text: string, baseDir: string, title: string): Promise<string> {
  const { parts, styles } = await columnContent(text, baseDir);

  const html = parts
    .map((part) => {
      switch (part.kind) {
        case "text":
          return escapeHtml(part.text);
        case "image":
          return `<img src="${escapeHtml(part.uri)}">`;
        case "title":
          return escapeHtml(title);
        case "page":
          return '<span class="pageNumber"></span>';
        default:
          return '<span class="totalPages"></span>';
      }
    })
    .join("");

  return styles.length > 0 ? `<span style="${escapeHtml(styles.join("; "))}">${html}</span>` : html;
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
 * Build a Chromium header/footer template (used when a header or footer has a
 * background image, which `@page` cannot paint). Columns are parsed exactly
 * as for margin boxes; `title` is the text `{title}` stands for.
 */
export async function buildPuppeteerTemplate(
  columns: HeaderFooterColumn,
  type: "header" | "footer",
  baseDir: string,
  title: string,
): Promise<string> {
  const column = (text: string | undefined) =>
    text ? buildColumnHtml(text, baseDir, title) : Promise.resolve("");

  const left = await column(columns.left);
  const center = await column(columns.center);
  const right = await column(columns.right);

  // Build background CSS if specified
  let backgroundCss = "";

  if (columns.background) {
    const dataUri = await imageToDataUri(columns.background, baseDir);

    if (dataUri) {
      // Header backgrounds anchor to bottom, footer to top
      const position = type === "header" ? "bottom" : "top";
      backgroundCss = `
				background-image: url(${cssString(dataUri)});
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
