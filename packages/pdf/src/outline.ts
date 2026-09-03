/**
 * Reading heading positions out of a generated PDF.
 *
 * Chrome writes a document outline when `page.pdf({ outline: true })` is used,
 * and every entry carries an explicit destination pointing at the page object
 * the heading landed on. That gives us the one thing CSS cannot: which printed
 * page a given heading ended up on.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName } from "@folknor/pdf-lib";

/** A heading from the PDF outline, with the page it appears on. */
export interface OutlineEntry {
  /** The heading text, exactly as it appears in the outline. */
  title: string;
  /** 1-based page number. */
  page: number;
}

/**
 * Read every outline entry from a PDF, flattened, in document order.
 *
 * Returns an empty array when the PDF has no outline, which is the normal case
 * for a document with no headings.
 */
export async function readOutline(
  pdfBytes: Buffer | Uint8Array,
): Promise<OutlineEntry[]> {
  const doc = await PDFDocument.load(new Uint8Array(pdfBytes));
  const outlines = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!outlines) {
    return [];
  }

  // Destinations reference page objects, so we need a ref -> index lookup.
  const pageIndexByRef = new Map<string, number>();
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page) {
      pageIndexByRef.set(page.ref.toString(), i + 1);
    }
  }

  const entries: OutlineEntry[] = [];

  function walk(node: PDFDict): void {
    let child = node.lookupMaybe(PDFName.of("First"), PDFDict);
    while (child) {
      // Titles are PDF strings (literal or hex), never names, so look them up
      // untyped and decode whatever came back.
      const rawTitle = child.lookup(PDFName.of("Title"));
      const text =
        rawTitle && "decodeText" in rawTitle
          ? (rawTitle as { decodeText(): string }).decodeText()
          : "";

      const dest = child.lookupMaybe(PDFName.of("Dest"), PDFArray);
      const target = dest?.get(0);
      const page = target ? pageIndexByRef.get(target.toString()) : undefined;

      if (text && page !== undefined) {
        entries.push({ title: text, page });
      }

      walk(child);
      child = child.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
  }

  walk(outlines);
  return entries;
}
