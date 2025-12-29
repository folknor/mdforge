import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarkedExtension, MarkedOptions } from "marked";
import type { FrameAddScriptTagOptions, launch, PDFOptions } from "puppeteer";
import type { TOCOptions } from "./toc.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const defaultConfig: Config = {
	basedir: process.cwd(),
	stylesheet: [resolve(__dirname, "..", "..", "markdown.css")],
	script: [],
	css: "",
	document_title: "",
	body_class: [],
	page_media_type: "screen",
	highlight_style: "github",
	marked_options: {},
	pdf_options: {
		printBackground: true,
		format: "a4",
		margin: {
			top: "30mm",
			right: "40mm",
			bottom: "30mm",
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
	 * List of css files to use for styling.
	 *
	 * @todo change to `FrameAddStyleTagOptions` (will be a breaking change)
	 */
	stylesheet: string[];

	/**
	 * Custom css styles.
	 */
	css: string;

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
}

export type PuppeteerLaunchOptions = Parameters<typeof launch>[0];
