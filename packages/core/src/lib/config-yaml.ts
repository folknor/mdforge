/**
 * The one place user YAML becomes configuration.
 *
 * Front matter and the CLI `--config-file` are both untrusted text. This module
 * parses that text into a `Partial<Config>` whose runtime values really have
 * their declared types, and reports everything it could not accept as issues.
 * Nothing outside this module inspects the runtime type of a config value.
 *
 * Policy, in one place:
 * - YAML is read as the YAML 1.2 core schema. A syntax error or any parser
 *   warning (an unresolved tag, a `%YAML 1.1` directive, ...) rejects the whole
 *   document, because the parser's warnings do not name the key they belong to.
 * - Explicit tags outside the core set (`!!set`, `!!binary`, custom tags) and
 *   aliases (`*name`) are rejected where they occur. Anchors are allowed.
 * - Every key is decoded against what mdforge consumes. An unknown key, or a
 *   value of the wrong type, is an issue and is left out; its valid siblings are
 *   kept. Lists of independent entries drop just the bad entry; a list whose
 *   entries depend on each other (browser `args`) or a fixed-size tuple fails
 *   as a whole.
 * - `@file` references are read only in free-text fields (stylesheets,
 *   header/footer text, templates for page.pdf, metadata, constants, ...),
 *   relative to the source's own directory, and only once: file contents that
 *   start with `@` are not followed again. Enums and path-valued fields take
 *   the string literally.
 * - Stylesheets are tagged path, URL or CSS here (see stylesheetEntry);
 *   relative paths resolve against the source's directory, and `@file`
 *   contents are always CSS.
 * - `launch_options` is only read from the config file: one browser is shared
 *   by every document of a run, so a per-document setting could not apply.
 * - Neither source can say where the output goes or whether it is PDF or HTML
 *   (no `dest`, `as_html` or `pdf_options.path`): those belong to the caller's
 *   invocation, and a document must not redirect what an application such as
 *   the desktop preview receives.
 */

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import type { PdfMetadata } from "@mdforge/pdf";
import type {
  ChromeReleaseChannel,
  FrameAddScriptTagOptions,
  LaunchOptions,
  LowerCasePaperFormat,
  PDFMargin,
  SupportedBrowser,
} from "puppeteer";
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type Node as YamlNode,
} from "yaml";
import {
  type Config,
  type HeaderFooterColumn,
  type PageNumberFormat,
  type PageNumbersConfig,
  type PdfOptions,
  type StylesheetEntry,
  type Theme,
  themes,
} from "./config.ts";
import type { Constant } from "./constants.ts";
import {
  type FontConfig,
  type FontPairingConfig,
  fontPairings,
  isFontPairingPreset,
} from "./fonts.ts";
import type { HeadingNumbersConfig } from "./heading-numbers.ts";
import type { TemplatesConfig } from "./includes.ts";
import type { TOCOptions, TOCStyle } from "./toc.ts";

/** One thing in the YAML that was not accepted. */
export interface ConfigIssue {
  /** Dotted key path, e.g. `pdf_options.margin.top`; empty for the document. */
  path: string;
  message: string;
}

/** Where the YAML came from; decides which keys it may set. */
export type ConfigSource = "config-file" | "front-matter";

export interface ConfigYamlOptions {
  source: ConfigSource;
  /** Directory `@file` references and relative stylesheets resolve against. */
  baseDir: string;
  /**
   * Absolute paths of files referenced through `@file` are appended here,
   * whether or not the read succeeded.
   */
  dependencies?: string[];
}

export interface ParsedConfig {
  config: Partial<Config>;
  issues: ConfigIssue[];
}

/** The part of Config a YAML document can express (functions cannot be). */
type YamlConfig = Omit<Config, "marked_extensions">;

/** The serialisable launch options a config file may set. */
type YamlLaunchOptions = Pick<
  LaunchOptions,
  | "acceptInsecureCerts"
  | "args"
  | "browser"
  | "channel"
  | "debuggingPort"
  | "devtools"
  | "dumpio"
  | "enableExtensions"
  | "env"
  | "executablePath"
  | "handleSIGHUP"
  | "handleSIGINT"
  | "handleSIGTERM"
  | "headless"
  | "ignoreDefaultArgs"
  | "pipe"
  | "protocolTimeout"
  | "slowMo"
  | "timeout"
  | "userDataDir"
  | "waitForInitialPage"
>;

// --
// YAML values

type YamlScalar = string | number | boolean | null;

/** A YAML value built from the document tree by `fromNode`, never asserted. */
type YamlValue = YamlScalar | YamlValue[] | Map<string, YamlValue>;

/** Tags of the YAML 1.2 core schema. */
const CORE_TAGS: ReadonlySet<string> = new Set(
  ["str", "int", "float", "bool", "null", "map", "seq"].map((name) => `tag:yaml.org,2002:${name}`),
);

/*
 * Runtime guards. Scalars come out of the yaml parser untyped; these are the
 * only `typeof` in the codebase that inspects configuration, and they sit at
 * the I/O boundary on purpose (oxlint.config.ts allows type-guard `typeof`
 * for this file alone).
 */

/** A scalar the core schema produces; anything else is unsupported. */
function isYamlScalar(value: unknown): value is YamlScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isString(value: YamlValue): value is string {
  return typeof value === "string";
}

function isNumber(value: YamlValue): value is number {
  return typeof value === "number";
}

function isBoolean(value: YamlValue): value is boolean {
  return typeof value === "boolean";
}

function isMapping(value: YamlValue): value is Map<string, YamlValue> {
  return value instanceof Map;
}

/** Name of a value's YAML kind, for messages. */
function kindOf(value: YamlValue): string {
  if (value === null) return "null";

  if (Array.isArray(value)) return "list";

  if (isMapping(value)) return "mapping";

  if (isString(value)) return "string";

  if (isNumber(value)) return "number";

  return "boolean";
}

interface Context {
  source: ConfigSource;
  baseDir: string;
  dependencies: string[];
  issues: ConfigIssue[];
}

function report(ctx: Context, path: string, message: string): undefined {
  ctx.issues.push({ path, message });
}

function childPath(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

/** Turn a parsed YAML node into a YamlValue, reporting what is unsupported. */
function fromNode(ctx: Context, path: string, node: YamlNode | null): YamlValue | undefined {
  // An empty value (`key:` with nothing after it) has no node.
  if (node === null) return null;

  if (isAlias(node)) {
    return report(ctx, path, "aliases (*name) are not supported");
  }

  if (node.tag !== undefined && !CORE_TAGS.has(node.tag)) {
    return report(ctx, path, `unsupported YAML tag ${node.tag}`);
  }

  if (isScalar(node)) {
    return isYamlScalar(node.value) ? node.value : report(ctx, path, "unsupported YAML value");
  }

  if (isSeq(node)) {
    const items: YamlValue[] = [];

    for (const [index, item] of node.items.entries()) {
      const itemPath = childPath(path, index);

      const value = isNode(item)
        ? fromNode(ctx, itemPath, item)
        : report(ctx, itemPath, "unsupported YAML value");

      if (value !== undefined) items.push(value);
    }

    return items;
  }

  if (isMap(node)) {
    const entries = new Map<string, YamlValue>();

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? pair.key.value : undefined;

      if (!isYamlScalar(key) || key === null || isBoolean(key)) {
        report(ctx, path, "mapping keys must be plain strings");
        continue;
      }

      const name = String(key);
      const keyPath = childPath(path, name);

      const value =
        pair.value === null || isNode(pair.value)
          ? fromNode(ctx, keyPath, pair.value)
          : report(ctx, keyPath, "unsupported YAML value");

      if (value !== undefined) entries.set(name, value);
    }

    return entries;
  }

  return report(ctx, path, "unsupported YAML value");
}

// --
// Decoders

/** Decodes one value at `path`; undefined means rejected (and reported). */
type Decoder<T> = (ctx: Context, path: string, value: YamlValue) => Promise<T | undefined>;

/** A decoder for every key of T, so none can be forgotten. */
type Decoders<T> = { [K in keyof T]-?: Decoder<NonNullable<T[K]>> };

function expected(ctx: Context, path: string, what: string, value: YamlValue): undefined {
  return report(ctx, path, `expected ${what}, got ${kindOf(value)}`);
}

const boolean: Decoder<boolean> = async (ctx, path, value) =>
  isBoolean(value) ? value : expected(ctx, path, "true or false", value);

/** A string taken literally: a path, a URL, an identifier. */
const literal: Decoder<string> = async (ctx, path, value) =>
  isString(value) ? value : expected(ctx, path, "a string", value);

/** Text read from the referenced file when it is an `@file` reference. */
interface Text {
  value: string;
  fromFile: boolean;
}

async function readText(ctx: Context, path: string, value: YamlValue): Promise<Text | undefined> {
  if (!isString(value)) return expected(ctx, path, "a string", value);

  if (!value.startsWith("@")) return { value, fromFile: false };

  const file = resolve(ctx.baseDir, value.slice(1));

  // Recorded before the read: a reference to a missing file is still one, so
  // watch mode re-renders when the file appears.
  ctx.dependencies.push(file);

  try {
    const content = await fs.readFile(file, "utf-8");

    return { value: content, fromFile: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return report(ctx, path, `cannot read ${value}: ${reason}`);
  }
}

/** Free text; an `@file` reference is replaced by the file's contents. */
const text: Decoder<string> = async (ctx, path, value) => (await readText(ctx, path, value))?.value;

function oneOf<T extends string>(
  allowed: readonly T[],
  normalise: (value: string) => string = (value) => value,
): Decoder<T> {
  return async (ctx, path, value) => {
    const found = isString(value)
      ? allowed.find((option) => option === normalise(value))
      : undefined;

    return (
      found ??
      report(
        ctx,
        path,
        `expected one of ${allowed.join(", ")}, got ${isString(value) ? JSON.stringify(value) : kindOf(value)}`,
      )
    );
  };
}

interface NumberRule {
  integer?: boolean;
  min?: number;
  max?: number;
  /** Lower bound excluded rather than included. */
  above?: number;
}

function number(rule: NumberRule = {}): Decoder<number> {
  return async (ctx, path, value) => {
    if (!isNumber(value) || !Number.isFinite(value)) {
      return expected(ctx, path, "a finite number", value);
    }

    if (rule.integer && !Number.isInteger(value)) {
      return report(ctx, path, `expected a whole number, got ${value}`);
    }

    if (rule.above !== undefined && value <= rule.above) {
      return report(ctx, path, `must be greater than ${rule.above}`);
    }

    if (rule.min !== undefined && value < rule.min) {
      return report(ctx, path, `must be at least ${rule.min}`);
    }

    if (rule.max !== undefined && value > rule.max) {
      return report(ctx, path, `must be at most ${rule.max}`);
    }

    return value;
  };
}

/** A CSS length: a string with a unit, or a bare number. */
const length: Decoder<string | number> = async (ctx, path, value) =>
  isString(value) ? value : number()(ctx, path, value);

/**
 * A list. Independent entries drop individually when one is rejected;
 * dependent entries (`whole`) reject the list.
 */
function list<T>(item: Decoder<T>, whole = false): Decoder<T[]> {
  return async (ctx, path, value) => {
    if (!Array.isArray(value)) return expected(ctx, path, "a list", value);

    const items: T[] = [];

    for (const [index, entry] of value.entries()) {
      const decoded = await item(ctx, childPath(path, index), entry);

      if (decoded !== undefined) items.push(decoded);
      else if (whole) return;
    }

    return items;
  };
}

/** A single entry or a list of them, as a list. */
function oneOrMany<T>(item: Decoder<T>): Decoder<T[]> {
  const many = list(item);

  return async (ctx, path, value) => {
    if (Array.isArray(value)) return many(ctx, path, value);

    const decoded = await item(ctx, path, value);

    return decoded === undefined ? [] : [decoded];
  };
}

function isFieldOf<T>(decoders: Decoders<T>, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(decoders, key);
}

/** A mapping with known keys, each decoded by its own decoder. */
function record<T>(decoders: Decoders<T>): Decoder<Partial<T>> {
  return async (ctx, path, value) => {
    if (!isMapping(value)) return expected(ctx, path, "a mapping", value);

    const fields = new Map<keyof T, T[keyof T]>();

    for (const [key, entry] of value) {
      const keyPath = childPath(path, key);

      if (!isFieldOf(decoders, key)) {
        // Top-level options are too many to list; nested ones are a handful.
        report(
          ctx,
          keyPath,
          path === ""
            ? "unknown option (see the configuration reference)"
            : `unknown option; known: ${Object.keys(decoders).join(", ")}`,
        );
        continue;
      }

      const decoded = await decoders[key](ctx, keyPath, entry);

      if (decoded !== undefined) fields.set(key, decoded);
    }

    // SAFETY: each entry was produced by the decoder for its own key, whose
    // result type is that key's value type in T.
    return Object.fromEntries(fields) as Partial<T>;
  };
}

/** A mapping with user-chosen keys and one decoder for every value. */
function dictionary<T>(
  entry: Decoder<T>,
  keyRule?: { pattern: RegExp; message: string },
): Decoder<Record<string, T>> {
  return async (ctx, path, value) => {
    if (!isMapping(value)) return expected(ctx, path, "a mapping", value);

    const entries = new Map<string, T>();

    for (const [key, item] of value) {
      const keyPath = childPath(path, key);

      if (keyRule && !keyRule.pattern.test(key)) {
        report(ctx, keyPath, keyRule.message);
        continue;
      }

      const decoded = await entry(ctx, keyPath, item);

      if (decoded !== undefined) entries.set(key, decoded);
    }

    return Object.fromEntries(entries);
  };
}

// --
// Field decoders

const theme: Decoder<Theme | false> = async (ctx, path, value) =>
  value === false ? false : oneOf(themes)(ctx, path, value);

/**
 * The one place a stylesheet's kind is read from its text. `@file` contents
 * are CSS whatever they look like (a lone `@import url(...)` line included);
 * otherwise an http(s) URL, text with `{` or a newline is inline CSS, and
 * anything else is a path relative to the source's directory.
 */
const stylesheetEntry: Decoder<StylesheetEntry> = async (ctx, path, value) => {
  const entry = await readText(ctx, path, value);

  if (entry === undefined || entry.value === "") return;

  const { value: sheet } = entry;

  if (entry.fromFile) return { type: "content", value: sheet };

  if (/^https?:\/\//i.test(sheet)) return { type: "url", value: sheet };

  if (sheet.includes("{") || sheet.includes("\n")) return { type: "content", value: sheet };

  return { type: "path", value: resolve(ctx.baseDir, sheet) };
};

const bodyClass: Decoder<string> = async (ctx, path, value) => {
  const name = await literal(ctx, path, value);

  return name === "" ? undefined : name;
};

const script = record<FrameAddScriptTagOptions>({
  url: literal,
  path: literal,
  content: text,
  type: literal,
  id: literal,
});

const MARGIN_SIDES = ["top", "right", "bottom", "left"] as const;

/** CSS shorthand: 1 to 4 lengths, expanded the way `margin` does. */
const margin: Decoder<PDFMargin> = async (ctx, path, value) => {
  if (!isString(value)) {
    return record<PDFMargin>({
      top: length,
      right: length,
      bottom: length,
      left: length,
    })(ctx, path, value);
  }

  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [top, right = top, bottom = top, left = right] = parts;

  if (top === undefined || parts.length > MARGIN_SIDES.length) {
    return report(
      ctx,
      path,
      `expected 1 to 4 lengths ("20mm", "20mm 15mm", ...), got ${JSON.stringify(value)}`,
    );
  }

  return { top, right, bottom, left };
};

const PAPER_FORMATS = [
  "letter",
  "legal",
  "tabloid",
  "ledger",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
] as const satisfies readonly LowerCasePaperFormat[];

const pdfOptions = record<PdfOptions>({
  scale: number({ min: 0.1, max: 2 }),
  displayHeaderFooter: boolean,
  headerTemplate: text,
  footerTemplate: text,
  printBackground: boolean,
  landscape: boolean,
  pageRanges: literal,
  format: oneOf(PAPER_FORMATS, (format) => format.toLowerCase()),
  width: length,
  height: length,
  preferCSSPageSize: boolean,
  margin,
  omitBackground: boolean,
  tagged: boolean,
  outline: boolean,
  timeout: number({ min: 0 }),
  waitForFonts: boolean,
});

const switchOrList: Decoder<boolean | string[]> = async (ctx, path, value) =>
  isBoolean(value) ? value : list(literal, true)(ctx, path, value);

const BROWSERS = ["chrome", "firefox"] as const satisfies readonly SupportedBrowser[];

const CHANNELS = [
  "chrome",
  "chrome-beta",
  "chrome-canary",
  "chrome-dev",
] as const satisfies readonly ChromeReleaseChannel[];

const launchOptionFields = record<YamlLaunchOptions>({
  acceptInsecureCerts: boolean,
  args: list(literal, true),
  browser: oneOf(BROWSERS),
  channel: oneOf(CHANNELS),
  debuggingPort: number({ integer: true, min: 0, max: 65_535 }),
  devtools: boolean,
  dumpio: boolean,
  enableExtensions: switchOrList,
  env: dictionary(literal),
  executablePath: literal,
  handleSIGHUP: boolean,
  handleSIGINT: boolean,
  handleSIGTERM: boolean,
  headless: async (ctx, path, value) =>
    value === "shell" || isBoolean(value)
      ? value
      : expected(ctx, path, 'true, false or "shell"', value),
  ignoreDefaultArgs: switchOrList,
  pipe: boolean,
  protocolTimeout: number({ min: 0 }),
  slowMo: number({ min: 0 }),
  timeout: number({ min: 0 }),
  userDataDir: literal,
  waitForInitialPage: boolean,
});

const launchOptions: Decoder<Partial<YamlLaunchOptions>> = async (ctx, path, value) =>
  ctx.source === "config-file"
    ? launchOptionFields(ctx, path, value)
    : report(
        ctx,
        path,
        "can only be set in the config file: one browser is shared by every document",
      );

const TOC_STYLES = ["bullet", "ordered", "table"] as const satisfies readonly TOCStyle[];

const tableHeaders: Decoder<[string, string]> = async (ctx, path, value) => {
  const cells = await list(text, true)(ctx, path, value);

  if (cells === undefined) return;

  const [title, page, ...rest] = cells;

  if (title === undefined || page === undefined || rest.length > 0) {
    return report(ctx, path, "expected exactly two cells: [title, page]");
  }

  return [title, page];
};

const tocOptions = record<TOCOptions>({
  skip_first_h1: boolean,
  maxdepth: number({ integer: true, min: 1, max: 6 }),
  style: oneOf(TOC_STYLES),
  page_numbers: boolean,
  page_label: text,
  page_separator: text,
  table_headers: tableHeaders,
});

const headerFooterColumn = record<HeaderFooterColumn>({
  left: text,
  center: text,
  right: text,
  background: text,
  firstPage: boolean,
});

/**
 * A plain string is the centered column; the rest of mdforge sees only
 * columns. A string that fails to decode (e.g. a missing `@file`) is dropped,
 * so an inherited header survives rather than being replaced by nothing.
 */
const headerFooter: Decoder<HeaderFooterColumn> = async (ctx, path, value) => {
  if (!isString(value)) return headerFooterColumn(ctx, path, value);

  const center = await text(ctx, path, value);

  return center === undefined ? undefined : { center };
};

const metadata = record<PdfMetadata>({
  title: text,
  author: text,
  subject: text,
  keywords: list(text),
  creator: text,
  producer: text,
});

const fontFields = record<FontConfig>({
  heading: literal,
  body: literal,
  mono: literal,
});

/** A preset name is resolved here, to a copy so no config aliases the table. */
const fonts: Decoder<FontPairingConfig> = async (ctx, path, value) => {
  if (!isString(value)) return fontFields(ctx, path, value);

  return isFontPairingPreset(value)
    ? { ...fontPairings[value] }
    : report(
        ctx,
        path,
        `unknown font preset "${value}"; available: ${Object.keys(fontPairings).join(", ")}`,
      );
};

const NUMBER_FORMATS = [
  "arabic",
  "roman",
  "roman-upper",
  "alpha",
  "alpha-upper",
] as const satisfies readonly PageNumberFormat[];

const pageNumbers = record<PageNumbersConfig>({
  format: oneOf(NUMBER_FORMATS),
  start: number({ integer: true, min: 1 }),
});

const headingNumberFields = record<HeadingNumbersConfig>({
  format: oneOf(NUMBER_FORMATS),
  start_depth: number({ integer: true, min: 1, max: 6 }),
  max_depth: number({ integer: true, min: 1, max: 6 }),
  separator: text,
  skip_first_h1: boolean,
});

const headingNumbers: Decoder<HeadingNumbersConfig | false> = async (ctx, path, value) =>
  value === false ? false : headingNumberFields(ctx, path, value);

const constantValue: Decoder<Constant> = async (ctx, path, value) => {
  if (isNumber(value)) {
    const n = await number()(ctx, path, value);

    return n === undefined ? undefined : { kind: "number", value: n };
  }

  const s = await text(ctx, path, value);

  return s === undefined ? undefined : { kind: "text", value: s };
};

const constants = dictionary(constantValue, {
  pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
  message:
    "constant names must start with a letter or underscore and contain only letters, digits and underscores",
});

const templates: Decoder<TemplatesConfig> = dictionary(literal);

const configFields = record<YamlConfig>({
  theme,
  print_urls: boolean,
  stylesheet: oneOrMany(stylesheetEntry),
  script: oneOrMany(script),
  document_title: text,
  body_class: oneOrMany(bodyClass),
  page_media_type: oneOf(["screen", "print"] as const),
  code_block_style: literal,
  pdf_options: pdfOptions,
  launch_options: launchOptions,
  toc_options: tocOptions,
  header: headerFooter,
  footer: headerFooter,
  metadata,
  fonts,
  font_scale: number({ above: 0 }),
  templates,
  page_numbers: pageNumbers,
  heading_numbers: headingNumbers,
  fillable: boolean,
  constants,
  constants_locale: literal,
  constants_precision: number({ integer: true, min: 0, max: 20 }),
  iconify_api: literal,
});

// --
// Entry points

/**
 * Parse YAML text (front matter or a config file) into configuration.
 *
 * Never throws for bad input: everything rejected is in `issues`, and
 * `config` holds only what was accepted.
 */
export async function parseConfigYaml(
  source: string,
  options: ConfigYamlOptions,
): Promise<ParsedConfig> {
  const ctx: Context = {
    source: options.source,
    baseDir: options.baseDir,
    dependencies: options.dependencies ?? [],
    issues: [],
  };

  const parsed = parseDocument(source, { version: "1.2", schema: "core" });

  const problems = [...parsed.errors, ...parsed.warnings];

  if (problems.length > 0) {
    return {
      config: {},
      issues: problems.map((problem) => ({
        path: "",
        message: `invalid YAML, ignored entirely: ${problem.message}`,
      })),
    };
  }

  const tree = fromNode(ctx, "", parsed.contents);

  if (tree === undefined || tree === null) {
    return { config: {}, issues: ctx.issues };
  }

  const config = await configFields(ctx, "", tree);

  return { config: config ?? {}, issues: ctx.issues };
}

/** Render issues as one warning block for CLI output. */
export function formatConfigIssues(issues: readonly ConfigIssue[], origin: string): string {
  const lines = issues.map(
    ({ path, message }) => `  - ${path === "" ? "(document)" : path}: ${message}`,
  );

  return [`Configuration problems in ${origin} (ignored):`, ...lines].join("\n");
}

/**
 * Markdown content split into its YAML front-matter text and the body.
 */
export interface FrontMatter {
  /** The YAML between the `---` lines, or undefined when there is none. */
  yaml: string | undefined;
  content: string;
}

/** Split YAML front-matter from markdown content, without parsing it. */
export function splitFrontMatter(content: string): FrontMatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);

  if (!match) return { yaml: undefined, content };

  return { yaml: match[1] ?? "", content: match[2] ?? "" };
}
