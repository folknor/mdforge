/**
 * Checking a `pageRanges` print against the settled whole-document print.
 *
 * Page references are resolved on whole-document prints (they name pages of
 * the document), so a page selection is printed once more after they have
 * settled. That print is checked where it can be: its page count must be the
 * selection's size, and every named destination must sit on the same document
 * page as in the settled print - those it shows, and those the selection
 * should contain. References whose targets lie outside the selection, and the
 * text references show, were checked on the settled print only.
 */

import type { PdfLayout } from "@mdforge/core/page-refs";

/**
 * The 1-based document pages a `pageRanges` value selects from a document of
 * `pageCount` pages, ascending and without repeats - read as Chromium reads
 * it: comma-separated `N`, `N-M`, `N-`, `-M` or `-`, blank entries skipped,
 * pages past the end dropped. Undefined for text Chromium rejects.
 */
export function selectedPages(ranges: string, pageCount: number): number[] | undefined {
  const pages = new Set<number>();
  const pageNumber = /^\d+$/;

  for (const entry of ranges.split(",")) {
    const range = entry.trim();

    if (range === "") continue;

    const parts = range.split("-").map((part) => part.trim());

    if (parts.length > 2 || parts.some((part) => part !== "" && !pageNumber.test(part))) {
      return undefined;
    }

    const [first = "", last = first] = parts;
    const start = first === "" ? 1 : Number(first);
    const end = last === "" ? pageCount : Number(last);

    if (start < 1 || start > end) return undefined;

    for (let page = start; page <= Math.min(end, pageCount); page++) pages.add(page);
  }

  return [...pages].toSorted((a, b) => a - b);
}

/**
 * Whether the ranged print matches the settled whole-document print on every
 * point it can be compared on.
 */
export function rangedPrintMatches(
  settled: PdfLayout,
  ranged: PdfLayout,
  selected: readonly number[],
): boolean {
  if (ranged.pageCount !== selected.length) return false;

  for (const [id, page] of ranged.destinations) {
    if (selected[page - 1] !== settled.destinations.get(id)) return false;
  }

  for (const [id, page] of settled.destinations) {
    const index = selected.indexOf(page);

    if (index !== -1 && ranged.destinations.get(id) !== index + 1) return false;
  }

  return true;
}
