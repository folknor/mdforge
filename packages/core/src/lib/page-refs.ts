/**
 * The print passes that resolve page references, shared by every renderer.
 *
 * A page reference (`@pageof(...)` or a TOC page number) can only be filled in
 * once the document has been laid out, so the PDF is printed, its named
 * destinations read back for the page each referenced element landed on, the
 * numbers written into the loaded page, and the page printed again, until they
 * settle. The page is loaded once: every pass prints the same page, so remote
 * content is fetched once and every pass lays out with the same resources.
 *
 * Passes print the whole document: references name pages of the document, not
 * of a page selection, so a `pageRanges` print is made (and checked) by the
 * caller after the numbers have settled.
 */

import type { PreparedConversion } from "./prepare.ts";
import { hasPageRefs, resolvePageRefs, type ShownPageRef } from "./xref.ts";

/** What a printed PDF says about its own layout. */
export interface PdfLayout {
  pageCount: number;
  /** Element id to the 1-based page its named destination is on. */
  destinations: ReadonlyMap<string, number>;
}

/**
 * Reads a printed PDF's layout. Renderers pass `readPdfLayout` from
 * `@mdforge/pdf`; it is a parameter so core carries no runtime dependency on
 * the PDF library.
 */
export type LayoutReader = (pdf: Uint8Array) => Promise<PdfLayout>;

/**
 * A loaded document that can be printed as often as needed. The caller owns
 * the page's lifetime; these passes only borrow it.
 */
export interface PrintablePage {
  /** Print the whole page, as it stands, to PDF. */
  print(): Promise<Uint8Array>;
  /** The page-reference spans the page shows, in document order. */
  readPageRefs(): Promise<ShownPageRef[]>;
  /** Set the number every reference to each slug shows. */
  writePageRefs(texts: ReadonlyMap<string, string>): Promise<void>;
}

/** The last print, and its layout when it was read. */
export interface SettledPrint {
  pdf: Uint8Array;
  /** Read only for a document with page references. */
  layout: PdfLayout | undefined;
}

/**
 * The most prints spent on one document while page references settle.
 *
 * Filling in a number can change line breaking and therefore pagination, which
 * can change the number. In practice one extra pass is enough; the cap stops a
 * pathological document from looping.
 */
const MAX_RENDERS = 3;

/**
 * Print a loaded PDF conversion, re-printing until its page references match
 * the pages their targets landed on.
 *
 * A document without page references is printed exactly once. Otherwise every
 * print's layout is read back, including the last, so the result is a print
 * whose numbers were checked against its own layout, as the page actually
 * showed them.
 *
 * This is best effort. If the numbers are still changing after the last
 * allowed print, that print is returned anyway, with a warning that its page
 * numbers may be wrong. References no destination answered for in the
 * returned print are named in a warning; in a settled print they show `??`.
 * Warnings are added to `prepared.info`, so call this once per prepared
 * conversion.
 *
 * @param prepared - The prepared conversion; it is never modified except for
 *   warnings
 * @param page - The loaded page, borrowed; never closed here
 * @param readLayout - Reads a printed PDF's layout
 */
export async function printResolvingPageRefs(
  prepared: PreparedConversion,
  page: PrintablePage,
  readLayout: LayoutReader,
): Promise<SettledPrint> {
  let pdf = await page.print();

  if (!hasPageRefs(prepared.html)) {
    return { pdf, layout: undefined };
  }

  for (let renders = 1; ; renders++) {
    const layout = await readLayout(pdf);
    const resolved = resolvePageRefs(await page.readPageRefs(), layout.destinations);

    // The numbers in this print already match its own layout.
    const settled = !resolved.changed;

    if (settled || renders === MAX_RENDERS) {
      if (!settled) {
        prepared.info.warnings.push(
          `Page references did not settle after ${MAX_RENDERS} renders; some page numbers may be wrong.`,
        );
      }

      if (resolved.unresolved.length > 0) {
        prepared.info.warnings.push(
          `Could not resolve page references for: ${resolved.unresolved.join(", ")}.`,
        );
      }

      return { pdf, layout };
    }

    await page.writePageRefs(resolved.texts);
    pdf = await page.print();
  }
}
