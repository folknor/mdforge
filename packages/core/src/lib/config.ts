import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { MarkedExtension } from "marked";
import type { FrameAddScriptTagOptions, launch, PDFOptions } from "puppeteer";
import type { FontConfig } from "./fonts.js";
import type { HeadingNumbersConfig } from "./heading-numbers.js";
import type { TemplatesConfig } from "./includes.js";
import type { PdfMetadata } from "./pdf-metadata.js";
import { type Theme, themes } from "./presets.js";
import type { TOCOptions } from "./toc.js";

export { themes, type Theme };
export type { HeadingNumbersConfig } from "./heading-numbers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface HeaderFooterColumn {
	left?: string;
	center?: string;
	right?: string;
	background?: string;
	firstPage?: boolean; // show on first page (default: true, only works without background)
}

export type HeaderFooterValue = string | HeaderFooterColumn;

/**
 * Page number format options.
 */
export type PageNumberFormat =
	| "arabic" // 1, 2, 3 (default)
	| "roman" // i, ii, iii
	| "roman-upper" // I, II, III
	| "alpha" // a, b, c
	| "alpha-upper"; // A, B, C

export interface PageNumbersConfig {
	/**
	 * Format for page numbers. Default: "arabic"
	 */
	format?: PageNumberFormat;
	/**
	 * Starting page number. Default: 1
	 */
	start?: number;
}

export const themesDir = resolve(__dirname, "..", "..", "themes");

export const defaultConfig: Config = {
	basedir: process.cwd(),
	theme: "beryl",
	print_urls: false,
	stylesheet: [],
	script: [],
	document_title: "",
	body_class: [],
	page_media_type: "screen",
	code_block_style: "github",
	pdf_options: {
		printBackground: true,
		format: "a4",
		margin: {
			top: "20mm",
			right: "20mm",
			bottom: "20mm",
			left: "20mm",
		},
	},
	launch_options: {},
	as_html: false,
	marked_extensions: [],
	toc_options: {
		skip_first_h1: false,
		maxdepth: 6,
	},
};

export interface Config {
	/**
	 * If true, generate HTML output instead of PDF output. Default: `false`.
	 */
	as_html: boolean;
	/**
	 * Base directory to be served by the file server.
	 */
	basedir: string;

	/**
	 * Optional destination path for the output file (including the extension).
	 */
	dest?: string;

	/**
	 * Built-in theme to use. Available: "beryl", "tufte", "buttondown", "pandoc".
	 * Default: "beryl". Set to false to disable built-in themes.
	 */
	theme?: Theme | false;

	/**
	 * If true, show URLs in parentheses after external links when printing.
	 * Default: false.
	 */
	print_urls: boolean;

	/**
	 * List of css files to use for styling (in addition to or instead of theme).
	 */
	stylesheet: string[];

	/**
	 * List of scripts to load into the page.
	 *
	 * @see https://github.com/puppeteer/puppeteer/blob/main/docs/api.md#pageaddscripttagoptions
	 */
	script: FrameAddScriptTagOptions[];

	/**
	 * Name of the HTML Document.
	 */
	document_title: string;

	/**
	 * List of classes for the body tag.
	 */
	body_class: string[];

	/**
	 * Media type to emulate the page with.
	 */
	page_media_type: "screen" | "print";

	/**
	 * Highlight.js stylesheet for code blocks (without the .css extension).
	 *
	 * @see https://highlightjs.org/examples
	 */
	code_block_style: string;

	/**
	 * PDF options for Puppeteer.
	 *
	 * @see https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions
	 */
	pdf_options: PDFOptions;

	/**
	 * Launch options for Puppeteer.
	 *
	 * @see https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions
	 */
	launch_options: PuppeteerLaunchOptions;

	/**
	 * Custm Extensions to be passed to marked.
	 *
	 * @see https://marked.js.org/using_pro#extensions
	 */
	marked_extensions: MarkedExtension[];

	/**
	 * Options for Table of Contents generation.
	 * TOC is generated when <!-- toc --> markers are present in the markdown.
	 */
	toc_options?: TOCOptions;

	/**
	 * Simplified header template. Supports placeholders: {title}, {date}, {page}, {pages}, {url}
	 * Can be a simple string (centered) or object with left/center/right columns.
	 * Markdown is supported and will be converted to HTML.
	 */
	header?: HeaderFooterValue;

	/**
	 * Simplified footer template. Supports placeholders: {title}, {date}, {page}, {pages}, {url}
	 * Can be a simple string (centered) or object with left/center/right columns.
	 * Markdown is supported and will be converted to HTML.
	 */
	footer?: HeaderFooterValue;

	/**
	 * PDF metadata (author, title, subject, keywords, etc.)
	 * Title is auto-detected from first h1 if not specified.
	 */
	metadata?: PdfMetadata;

	/**
	 * Font configuration. Can be:
	 * - A preset name: "classic-elegant", "modern-professional", etc.
	 * - An object with custom fonts: { heading, body, mono }
	 *
	 * Theme names (beryl, tufte, etc.) are also valid presets.
	 */
	fonts?: FontConfig | string;

	/**
	 * Scale factor for all font sizes. Default: 1.
	 * Values > 1 increase sizes, < 1 decrease.
	 * Example: 1.2 makes 12pt base become 14.4pt.
	 */
	font_scale?: number;

	/**
	 * Named templates for @include.
	 * Maps template names to file paths.
	 */
	templates?: TemplatesConfig;

	/**
	 * Page number formatting options.
	 * Controls the format (arabic, roman, etc.) and starting number.
	 */
	page_numbers?: PageNumbersConfig;

	/**
	 * Heading numbering options.
	 * Automatically numbers headings in the document (e.g., 1., 1.1., 1.2.).
	 */
	heading_numbers?: HeadingNumbersConfig;
}

export type PuppeteerLaunchOptions = Parameters<typeof launch>[0];
