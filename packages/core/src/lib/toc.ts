/*!
 * Table of Contents generation for mdforge
 * Adapted from markdown-toc <https://github.com/jonschlinkert/markdown-toc>
 *
 * Copyright (c) 2013-2023, Jon Schlinkert.
 * Released under the MIT License.
 */

import { escapeHtml } from "./util.ts";
import { pageRefSpan } from "./xref.ts";

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

/** One heading as the TOC lists it. */
export interface TocEntry {
  depth: number;
  /** The heading's element id, exactly as rendered. */
  id: string;
  /** Finished inline HTML for the entry, number prefix included. */
  label: string;
}

/**
 * The TOC markup for `entries`, the document-level headings that follow the
 * TOC marker, in document order.
 *
 * The TOC is generated as HTML, not markdown: its labels are already rendered
 * heading HTML, and feeding that back through markdown would re-interpret it
 * (a heading written `\*x\*` renders `*x*`, which markdown would emphasise).
 */
export function renderToc(entries: readonly TocEntry[], options: TOCOptions = {}): string {
  const maxdepth = options.maxdepth ?? 6;
  let listed = entries.filter((entry) => entry.depth <= maxdepth);
  const first = listed[0];

  // Skip the first entry if it is an h1 (usually the document title).
  if (options.skip_first_h1 && first?.depth === 1) {
    listed = listed.slice(1);
  }

  if (listed.length === 0) {
    return "";
  }

  if (options.style === "table") {
    return renderTable(listed, options);
  }

  return renderList(listed, options);
}

/** Page reference for an entry, or "" when page numbers are off. */
function pageRef(entry: TocEntry, options: TOCOptions): string {
  if (!options.page_numbers) {
    return "";
  }

  return `${escapeHtml(options.page_label ?? "")}${pageRefSpan(entry.id)}`;
}

function entryLink(entry: TocEntry): string {
  return `<a href="#${escapeHtml(entry.id)}">${entry.label}</a>`;
}

/**
 * Nested lists, one level per step down in heading depth. A jump of several
 * levels (h2 straight to h4) nests one level, and an entry shallower than the
 * first one joins the outermost list.
 */
function renderList(entries: readonly TocEntry[], options: TOCOptions): string {
  const tag = options.style === "ordered" ? "ol" : "ul";
  const separator = escapeHtml(options.page_separator ?? " — ");
  const parts: string[] = [];
  // Depth of each open list, outermost first. Every open list has an open <li>.
  const open: number[] = [];

  for (const entry of entries) {
    let top = open.at(-1);

    if (top === undefined) {
      parts.push(`<${tag}>\n<li>`);
      open.push(entry.depth);
    } else {
      while (open.length > 1 && top !== undefined && entry.depth < top) {
        const outer = open.at(-2) ?? 0;

        // Deeper than the enclosing list: a sibling in the current one (h2,
        // h4, h3 lists the h4 and h3 together under the h2).
        if (entry.depth > outer) {
          open[open.length - 1] = entry.depth;
          top = entry.depth;
          break;
        }

        parts.push(`</li>\n</${tag}>`);
        open.pop();
        top = open.at(-1);
      }

      if (top !== undefined && entry.depth > top) {
        parts.push(`\n<${tag}>\n<li>`);
        open.push(entry.depth);
      } else {
        if (top !== undefined && entry.depth < top) {
          open[open.length - 1] = entry.depth;
        }

        parts.push("</li>\n<li>");
      }
    }

    const page = pageRef(entry, options);
    parts.push(`${entryLink(entry)}${page ? `${separator}${page}` : ""}`);
  }

  for (let i = 0; i < open.length; i++) {
    parts.push(`</li>\n</${tag}>`);
  }

  return `${parts.join("")}\n`;
}

/** Two-column contents table, the shape printed documents usually want. */
function renderTable(entries: readonly TocEntry[], options: TOCOptions): string {
  const highest = Math.min(...entries.map((entry) => entry.depth));
  const [titleHeader, pageHeader] = options.table_headers ?? ["", ""];

  const rows = entries.map((entry) => {
    // Nesting is expressed with non-breaking spaces inside the title cell.
    const indentation = "&nbsp;&nbsp;".repeat(entry.depth - highest);

    return `<tr>\n<td>${indentation}${entryLink(entry)}</td>\n<td>${pageRef(entry, options)}</td>\n</tr>`;
  });

  return [
    "<table>",
    "<thead>",
    "<tr>",
    `<th>${escapeHtml(titleHeader)}</th>`,
    `<th>${escapeHtml(pageHeader)}</th>`,
    "</tr>",
    "</thead>",
    "<tbody>",
    ...rows,
    "</tbody>",
    "</table>",
    "",
  ].join("\n");
}
