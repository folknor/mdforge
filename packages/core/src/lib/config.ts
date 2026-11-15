import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PdfMetadata } from "@mdforge/pdf";
import type { MarkedExtension } from "marked";
import type { Constants } from "./constants.ts";
import type { FontPairingConfig } from "./fonts.ts";
import type { HeadingNumbersConfig } from "./heading-numbers.ts";
import type { TemplatesConfig } from "./includes.ts";
import { type Theme, themes } from "./presets.ts";
import type { TOCOptions } from "./toc.ts";

export type { HeadingNumbersConfig } from "./heading-numbers.ts";

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

/**
 * One script added to the page after it has loaded: a URL for the page to
 * load (`url`), a file whose text is added inline (`path`, absolute or
 * relative to the working directory) or code (`content`). `type` and `id` are
 * the script element's attributes.
 */
export interface ScriptEntry {
  kind: "url" | "path" | "content";
  value: string;
  type?: string;
  id?: string;
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
  marked_extensions: [],
  toc_options: {
    skip_first_h1: false,
    maxdepth: 6,
    style: "bullet",
    page_numbers: false,
  },
};

/** A paper size name. */
export type PaperFormat =
  | "letter"
  | "legal"
  | "tabloid"
  | "ledger"
  | "a0"
  | "a1"
  | "a2"
  | "a3"
  | "a4"
  | "a5"
  | "a6";

/**
 * A length: a number is CSS pixels (96 per inch); a string is a number with
 * an optional unit (`px`, `in`, `cm`, `mm`, `pt`, `pc`; none means `px`).
 */
export type PdfLength = string | number;

export interface PdfMargin {
  top?: PdfLength;
  right?: PdfLength;
  bottom?: PdfLength;
  left?: PdfLength;
}

/**
 * How the PDF is printed. Every field is honoured by both renderers: they are
 * turned into one print specification by @mdforge/render (print-spec.ts), so
 * the meaning of each, and its default, is defined there once. There is no
 * output path (mdforge writes the output to the target its caller chose, see
 * ConvertOptions), and PDFs are always tagged and carry an outline.
 */
export interface PdfOptions {
  /** Paper size; overrides `width` and `height`. Default: Letter. */
  format?: PaperFormat;
  width?: PdfLength;
  height?: PdfLength;
  landscape?: boolean;
  /** Default: no margins. */
  margin?: PdfMargin;
  /** 0.1 to 2. Default: 1. */
  scale?: number;
  /** Default: false. */
  printBackground?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  /** Pages to print, e.g. `"1-5, 8, 11-"`. Default: all. */
  pageRanges?: string;
  /** Let a CSS `@page { size }` decide the paper size. */
  preferCSSPageSize?: boolean;
  /**
   * Milliseconds one print may take (waiting for fonts, then printing);
   * 0 means no limit. Default: 30000.
   */
  timeout?: number;
}

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
   * Scripts added to the page, in order, after it has loaded (see
   * `addPageScript` in page-load.ts for what is waited on).
   */
  script: ScriptEntry[];

  /**
   * Name of the HTML Document.
   */
  document_title: string;

  /**
   * List of classes for the body tag.
   */
  body_class: string[];

  /**
   * Media type the page is loaded and printed with, in both renderers.
   */
  page_media_type: "screen" | "print";

  /**
   * Highlight.js stylesheet for code blocks (without the .css extension).
   *
   * @see https://highlightjs.org/examples
   */
  code_block_style: string;

  /** How the PDF is printed. */
  pdf_options: PdfOptions;

  /**
   * Custom extensions to be passed to marked.
   *
   * Headings they render themselves are outside mdforge's outline (no id,
   * not in the TOC or `@numberof`); they must not add, clone or reorder
   * heading tokens after lexing, and must lex without side effects. The full
   * contract is in outline.ts.
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
   * Set to a self-hosted instance URL for air-gapped deployments. Must be an
   * http(s) base URL without credentials, query or fragment. YAML can set it
   * only from the config file, never front matter.
   */
  iconify_api?: string;
}

/**
 * How the Puppeteer renderer launches its browser: the launch options a YAML
 * config file can express. This is not part of Config - it describes a
 * browser, not a document - and the Electron renderer, which launches
 * nothing, has no use for it. renderer-puppeteer passes it to Puppeteer's
 * `launch`, which type-checks it against Puppeteer's own options.
 */
export interface LaunchSettings {
  acceptInsecureCerts?: boolean;
  args?: string[];
  browser?: "chrome" | "firefox";
  channel?: "chrome" | "chrome-beta" | "chrome-canary" | "chrome-dev";
  debuggingPort?: number;
  devtools?: boolean;
  dumpio?: boolean;
  enableExtensions?: boolean | string[];
  env?: Record<string, string>;
  executablePath?: string;
  handleSIGHUP?: boolean;
  handleSIGINT?: boolean;
  handleSIGTERM?: boolean;
  headless?: boolean | "shell";
  ignoreDefaultArgs?: boolean | string[];
  pipe?: boolean;
  protocolTimeout?: number;
  slowMo?: number;
  timeout?: number;
  userDataDir?: string;
  waitForInitialPage?: boolean;
}
