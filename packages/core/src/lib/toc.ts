/*!
 * Table of Contents generation for mdforge
 * Adapted from markdown-toc <https://github.com/jonschlinkert/markdown-toc>
 *
 * Copyright (c) 2013-2023, Jon Schlinkert.
 * Released under the MIT License.
 */

import GithubSlugger from "github-slugger";
import { marked, type Token, type Tokens } from "marked";
import {
  HeadingNumberer,
  type HeadingNumbersConfig,
} from "./heading-numbers.js";
import { cleanForSlug } from "./slugger.js";
import { pageRefSpan } from "./xref.js";

/** Output shape of a generated table of contents. */
export type TOCStyle = "bullet" | "ordered" | "table";

export interface TOCOptions {
  /** Skip the first h1 heading in the TOC (usually the document title). Default: false */
  skip_first_h1?: boolean;
  /** Maximum heading depth to include (1-6). Default: 6 */
  maxdepth?: number;
  /**
   * Output shape: a bullet list, a numbered list, or a two-column
   * title/page table like a printed contents page. Default: "bullet"
   */
  style?: TOCStyle;
  /**
   * Append the printed page number of each heading, resolved from the
   * laid-out PDF the same way `@pageof(...)` is. Default: false
   */
  page_numbers?: boolean;
  /**
   * Text placed immediately before a page number, e.g. `"Side "` or `"p. "`.
   * Default: "" (the bare number)
   */
  page_label?: string;
  /**
   * Separator between the entry title and its page number, for the "bullet"
   * and "ordered" styles. Ignored by "table". Default: " — "
   */
  page_separator?: string;
  /**
   * Header cells for the "table" style, as `[title, page]`. Both default to
   * empty strings, which renders a headerless contents table.
   */
  table_headers?: [string, string];
}

export interface HeadingToken {
  content: string;
  slug: string;
  lvl: number;
  i: number;
  seen: number;
}

interface TOCResult {
  content: string;
  json: HeadingToken[];
  highest: number;
}

/**
 * Adapter to work with marked tokens and provide TOC generation.
 */
class MarkedAdapter {
  private options: TOCOptions;
  private slugger = new GithubSlugger();
  private numberer: HeadingNumberer | undefined;
  private headings: HeadingToken[] = [];

  constructor(options: TOCOptions = {}, headingNumbers?: HeadingNumbersConfig) {
    this.options = {
      skip_first_h1: false,
      maxdepth: 6,
      style: "bullet",
      page_numbers: false,
      page_label: "",
      page_separator: " — ",
      ...options,
    };
    this.numberer = headingNumbers
      ? new HeadingNumberer(headingNumbers)
      : undefined;
  }

  /**
   * @param content - Markdown the TOC is generated from (everything after the marker)
   * @param preceding - Markdown before the marker; its headings are consumed to
   *   keep slug de-duplication and heading numbering in step with the document,
   *   but they do not appear in the TOC.
   */
  public parse(content: string, preceding = ""): TOCResult {
    if (preceding.trim()) {
      this.extractHeadings(marked.lexer(preceding));
      // Those headings only primed the slugger/numberer.
      this.headings = [];
    }
    const tokens = marked.lexer(content);
    this.extractHeadings(tokens);
    this.processHeadings();
    const tocContent = this.generateTOCContent();
    const jsonOutput = this.generateJSONOutput();

    return {
      content: tocContent,
      json: jsonOutput,
      highest: this.getHighestLevel(),
    };
  }

  private extractHeadings(tokens: Token[]): void {
    for (const token of tokens) {
      if (token.type === "heading") {
        this.processHeadingToken(token);
      }
    }
  }

  private processHeadingToken(token: Token): void {
    if (token.type !== "heading") {
      return;
    }

    const headingToken = token as Tokens.Heading;
    const headingDepth = headingToken.depth;

    const text = this.getTokenText(token);
    // Every heading is slugged and numbered, even ones the TOC will not show,
    // so de-duplication suffixes and counters match the rendered document.
    const slug = this.slugger.slug(cleanForSlug(headingToken.text));
    const numbered = this.numberer
      ? this.numberer.apply(headingDepth, text)
      : text;

    // Skip headings beyond maxdepth
    if (headingDepth > (this.options.maxdepth ?? 6)) {
      return;
    }

    const heading: HeadingToken = {
      content: numbered,
      slug,
      lvl: headingDepth,
      i: this.headings.length,
      seen: 0,
    };

    this.headings.push(heading);
  }

  private getTokenText(token: Token): string {
    if (token.type === "heading") {
      return (token as Tokens.Heading).text;
    }
    if (token.type === "text") {
      return (token as Tokens.Text).text;
    }
    if (token.type === "link") {
      const linkToken = token as Tokens.Link;
      return linkToken.text || linkToken.href;
    }
    if (
      token.type === "strong" ||
      token.type === "em" ||
      token.type === "codespan"
    ) {
      return (token as Tokens.Strong | Tokens.Em | Tokens.Codespan).text;
    }
    if ("text" in token && typeof token.text === "string") {
      return token.text;
    }
    if ("tokens" in token && Array.isArray(token.tokens)) {
      return token.tokens.map((t) => this.getTokenText(t)).join("");
    }
    return "";
  }

  private processHeadings(): void {
    // Skip first h1 if enabled (usually the document title)
    const firstHeading = this.headings[0];
    if (this.options.skip_first_h1 && firstHeading && firstHeading.lvl === 1) {
      this.headings = this.headings.slice(1);
    }
  }

  /** Page reference cell for a heading, or "" when page numbers are off. */
  private pageRef(heading: HeadingToken): string {
    if (!this.options.page_numbers) {
      return "";
    }
    return `${this.options.page_label ?? ""}${pageRefSpan(heading.slug)}`;
  }

  private generateTOCContent(): string {
    if (this.options.style === "table") {
      return this.generateTable();
    }
    return this.generateList();
  }

  private generateList(): string {
    const lines: string[] = [];
    const highestLevel = this.getHighestLevel();
    const marker = this.options.style === "ordered" ? "1." : "-";

    // `this.headings` only ever holds headings within maxdepth; deeper ones
    // are dropped while extracting.
    for (const heading of this.headings) {
      const indentLevel = Math.max(0, heading.lvl - highestLevel);
      const indentation = "  ".repeat(indentLevel);
      const page = this.pageRef(heading);
      const suffix = page
        ? `${this.options.page_separator ?? " — "}${page}`
        : "";

      lines.push(
        `${indentation}${marker} [${escapeLinkText(heading.content)}](#${heading.slug})${suffix}`,
      );
    }

    return lines.join("\n");
  }

  /** Two-column contents table, the shape printed documents usually want. */
  private generateTable(): string {
    const highestLevel = this.getHighestLevel();
    const [titleHeader, pageHeader] = this.options.table_headers ?? ["", ""];
    const lines = [
      `| ${escapeCell(titleHeader)} | ${escapeCell(pageHeader)} |`,
      "| --- | --- |",
    ];

    for (const heading of this.headings) {
      // Markdown indentation is meaningless inside a table cell, so nesting is
      // expressed with non-breaking spaces instead.
      const indentLevel = Math.max(0, heading.lvl - highestLevel);
      const indentation = "&nbsp;&nbsp;".repeat(indentLevel);
      // Both escapes apply here: the text is link text inside a table cell.
      const title = `${indentation}[${escapeCell(escapeLinkText(heading.content))}](#${heading.slug})`;
      lines.push(`| ${title} | ${this.pageRef(heading)} |`);
    }

    return lines.join("\n");
  }

  private generateJSONOutput(): HeadingToken[] {
    return this.headings.map((heading) => ({
      content: heading.content,
      slug: heading.slug,
      lvl: heading.lvl,
      i: heading.i,
      seen: heading.seen,
    }));
  }

  private getHighestLevel(): number {
    if (this.headings.length === 0) return 1;
    return Math.min(...this.headings.map((h) => h.lvl));
  }
}

/** Escape the one character that would break out of a markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/**
 * Escape the brackets that would terminate (or nest inside) the `[...]` part
 * of a markdown link. A heading like "Arrays [advanced]" otherwise closes the
 * link text early and leaves stray text and a broken anchor in the TOC.
 */
function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, "\\$&");
}

/**
 * Generate a table of contents from markdown content.
 */
function toc(
  str: string,
  options: TOCOptions = {},
  headingNumbers?: HeadingNumbersConfig,
  preceding = "",
): TOCResult {
  const adapter = new MarkedAdapter(options, headingNumbers);
  return adapter.parse(str, preceding);
}

/**
 * Insert a table of contents into markdown content.
 * Looks for <!-- toc --> and <!-- tocstop --> markers.
 *
 * @param str - Markdown string
 * @param options - TOC generation options
 * @param headingNumbers - Heading numbering config, when enabled, so entries
 *   carry the same numbers as the rendered headings
 * @returns Markdown with TOC inserted (or original if no markers)
 */
export function insertToc(
  str: string,
  options: TOCOptions = {},
  headingNumbers?: HeadingNumbersConfig | false,
): string {
  const regex = /(?:<!-- toc(?:\s*stop)? -->)/g;
  const open = "<!-- toc -->\n\n";
  const close = "\n<!-- tocstop -->";

  // Preserve trailing newlines
  const newlines = (/\n+$/.exec(str) || [""])[0];

  const sections = str.split(regex).map((s) => s.trim());

  if (sections.length === 1) {
    // No markers found, return unchanged
    return str;
  }

  if (sections.length > 3) {
    throw new Error("mdforge only supports one Table of Contents per file.");
  }

  const last = sections[sections.length - 1] as string;
  // Headings before the opening marker still consume slugs and heading
  // numbers. Only sections[0] is document text: when both markers are present
  // sections[1] is the previously generated TOC body, which must not be
  // re-parsed or its links would consume slugs a second time.
  const preceding = sections[0] as string;
  const tocContent = toc(
    last,
    options,
    headingNumbers || undefined,
    preceding,
  ).content;

  if (sections.length === 3) {
    // Both markers present: <!-- toc --> content <!-- tocstop -->
    sections.splice(1, 1, open + tocContent);
    sections.splice(2, 0, close);
  } else if (sections.length === 2) {
    // Only opening marker: <!-- toc -->
    sections.splice(1, 0, `${open}${tocContent}${close}`);
  }

  return sections.join("\n\n") + newlines;
}
