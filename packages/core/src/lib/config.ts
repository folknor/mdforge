import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PdfMetadata } from "@mdforge/pdf";
import type { MarkedExtension } from "marked";
import type { FrameAddScriptTagOptions, launch, PDFOptions } from "puppeteer";
import type { Constants } from "./constants.js";
import type { FontPairingConfig } from "./fonts.js";
import type { HeadingNumbersConfig } from "./heading-numbers.js";
import type { TemplatesConfig } from "./includes.js";
import { type Theme, themes } from "./presets.js";
import type { TOCOptions } from "./toc.js";

export type { HeadingNumbersConfig } from "./heading-numbers.js";

export { type Theme, themes };

const moduleDir: string = fileURLToPath(new URL(".", import.meta.url));

/**
 * One stylesheet: a file to read (`path`, absolute or relative to the working
 * directory), CSS text (`content`) or a URL for the page to load (`url`).
 */
export interface StylesheetEntry {
  type: "path" | "content" | "url";
  value: string;
}

export interface HeaderFooterColumn {
  left?: string;
  center?: string;
  right?: string;
  background?: string;
  firstPage?: boolean; // show on first page (default: true, only works without background)
}

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

export const themesDir: string = resolve(moduleDir, "..", "..", "themes");

export const defaultConfig: Config = {
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
  marked_extensions: [],
  toc_options: {
    skip_first_h1: false,
    maxdepth: 6,
    style: "bullet",
    page_numbers: false,
  },
};

/**
 * Puppeteer's PDF options without `path`. mdforge writes the output itself, to
 * the target its caller chose (see ConvertOptions); a `path` here would make
 * Puppeteer write a second, unpostprocessed copy wherever it pointed.
 */
export type PdfOptions = Omit<PDFOptions, "path">;

/**
 * How a document is rendered. Where the result goes and whether it is PDF or
 * HTML are not configuration: the caller decides them per invocation
 * (ConvertOptions `output` and `format`), so a document's front matter cannot
 * redirect or reshape what an application receives.
 */
export interface Config {
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
   * Stylesheets to apply after the theme, in cascade order. Each entry says
   * what it is; nothing downstream inspects the text to guess.
   */
  stylesheet: StylesheetEntry[];

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
  pdf_options: PdfOptions;

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
   * Left/center/right columns; a plain YAML string is decoded as `{ center }`.
   * A header with no non-empty column or background is inactive.
   * Markdown is supported and will be converted to HTML.
   */
  header?: HeaderFooterColumn;

  /**
   * Simplified footer template. Supports placeholders: {title}, {date}, {page}, {pages}, {url}
   * Left/center/right columns; a plain YAML string is decoded as `{ center }`.
   * A footer with no non-empty column or background is inactive.
   * Markdown is supported and will be converted to HTML.
   */
  footer?: HeaderFooterColumn;

  /**
   * PDF metadata (author, title, subject, keywords, etc.)
   * Title is auto-detected from first h1 if not specified.
   */
  metadata?: PdfMetadata;

  /**
   * Font configuration: { heading, body, mono } plus optional fallbacks.
   * A YAML preset name ("classic-elegant", a theme name, ...) is resolved to
   * its pairing when the config is parsed; programmatic callers resolve with
   * `isFontPairingPreset` and `fontPairings`. When unset, the theme's pairing
   * is used.
   */
  fonts?: FontPairingConfig;

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
   * `false` turns numbering off, overriding a config file that enabled it.
   */
  heading_numbers?: HeadingNumbersConfig | false;

  /**
   * If true, generate fillable PDF forms with real AcroForm fields.
   * Form fields rendered by marked-forms will become interactive in PDF readers.
   * Default: false (renders print-friendly static forms).
   * Note: Ignored for HTML output.
   */
  fillable?: boolean;

  /**
   * Named values substituted into `{{ ... }}` placeholders in the document.
   * Numeric constants can also be combined arithmetically: `{{ rate * 1.5 }}`.
   */
  constants?: Constants;

  /**
   * BCP 47 locale used to format numeric `{{ ... }}` results, e.g. "nb-NO"
   * renders 15000 as `15 000`. Default: unformatted.
   */
  constants_locale?: string;

  /**
   * Maximum fraction digits in a `{{ ... }}` result. Default: 2.
   */
  constants_precision?: number;

  /**
   * Iconify API endpoint for fetching icons.
   * Default: "https://api.iconify.design"
   * Set to a self-hosted instance URL for air-gapped deployments.
   */
  iconify_api?: string;
}

export type PuppeteerLaunchOptions = Parameters<typeof launch>[0];
