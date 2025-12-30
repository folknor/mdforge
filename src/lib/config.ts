import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarkedExtension, MarkedOptions } from "marked";
import type { FrameAddScriptTagOptions, launch, PDFOptions } from "puppeteer";
import type { TOCOptions } from "./toc.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const themes = ["beryl", "tufte", "buttondown", "pandoc"] as const;
export type Theme = (typeof themes)[number];

export interface HeaderFooterColumn {
	left?: string;
	center?: string;
	right?: string;
}

export type HeaderFooterValue = string | HeaderFooterColumn;

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
	highlight_style: "github",
	marked_options: {},
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
		firsth1: true,
		maxdepth: 6,
		bullets: ["-"],
		indent: "  ",
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
	 * Highlight.js stylesheet to use (without the .css extension).
	 *
	 * @see https://github.com/isagalaev/highlight.js/tree/master/src/styles
	 */
	highlight_style: string;

	/**
	 * Options for the Marked parser.
	 *
	 * @see https://marked.js.org/#/USING_ADVANCED.md
	 */
	marked_options: MarkedOptions;

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
	 * Use paged.js for header/footer rendering instead of Puppeteer's native headers.
	 * Enables advanced features like running headers (chapter titles) and page exceptions.
	 * Default: false
	 */
	paged_js?: boolean;

	/**
	 * Show header on first page. Only applies when paged_js is enabled.
	 * Default: true
	 */
	firstPageHeader?: boolean;

	/**
	 * Show footer on first page. Only applies when paged_js is enabled.
	 * Default: true
	 */
	firstPageFooter?: boolean;
}

export type PuppeteerLaunchOptions = Parameters<typeof launch>[0];
