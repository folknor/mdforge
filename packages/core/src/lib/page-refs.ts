/**
 * The render passes that resolve page references, shared by every renderer.
 *
 * A page reference (`@pageof(...)` or a TOC page number) can only be filled in
 * once the document has been laid out, so the PDF is printed, its named
 * destinations read back for the page each referenced element landed on, the
 * numbers written into the loaded page, and the page printed again, until they
 * settle. The page is loaded once: every pass prints the same page, so remote
 * content is fetched once and every pass lays out with the same resources.
 */

import type { PreparedConversion } from "./prepare.ts";
import { hasPageRefs, resolvePageRefs, type ShownPageRef } from "./xref.ts";

/**
 * Reads a PDF's named destinations: element id to 1-based page. Renderers pass
 * `readDestinations` from `@mdforge/pdf`; it is a parameter so core carries no
 * runtime dependency on the PDF library.
 */
export type DestinationReader = (pdf: Uint8Array) => Promise<ReadonlyMap<string, number>>;

/** A document loaded in a renderer, ready to print as often as needed. */
export interface LoadedPage<R> {
  /** Print the page as it stands. */
  print(): Promise<R>;
  /** The page-reference spans the page shows, in document order. */
  readPageRefs(): Promise<ShownPageRef[]>;
  /** Set the number every reference to each slug shows. */
  writePageRefs(texts: ReadonlyMap<string, string>): Promise<void>;
  /** Release the page; called exactly once. */
  close(): Promise<void>;
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
 * Load a prepared conversion and print it, re-printing until its page
 * references match the pages their targets landed on.
 *
 * HTML output, or a document without page references, is printed exactly
 * once. Otherwise every print's destinations are read back, including the
 * last, so the result is a print whose numbers were checked against its own
 * layout, as the page actually showed them.
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
 * @param open - Loads the conversion into a fresh page
 * @param readDestinations - Reads the printed PDF's named destinations
 * @returns The last complete print result
 */
export async function renderResolvingPageRefs<R extends { content: Buffer | Uint8Array | string }>(
  prepared: PreparedConversion,
  open: (prepared: PreparedConversion) => Promise<LoadedPage<R>>,
  readDestinations: DestinationReader,
): Promise<R> {
  const page = await open(prepared);

  try {
    let output = await page.print();

    if (prepared.format !== "pdf" || !hasPageRefs(prepared.html)) {
      return output;
    }

    for (let renders = 1; ; renders++) {
      // Buffer extends Uint8Array, so this only rejects HTML output, which the
      // format check above already rules out.
      if (!(output.content instanceof Uint8Array)) {
        throw new Error("Expected PDF output while resolving page references");
      }

      const destinations = await readDestinations(output.content);
      const resolved = resolvePageRefs(await page.readPageRefs(), destinations);

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

        return output;
      }

      await page.writePageRefs(resolved.texts);
      output = await page.print();
    }
  } finally {
    await page.close();
  }
}
