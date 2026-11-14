/**
 * Reading element positions out of a generated PDF.
 *
 * Chromium writes a named destination, keyed by the element's `id`, for every
 * element that an in-document link (`<a href="#id">`) points at - even a link
 * that is empty or `display: none`. Each destination names the page object the
 * element landed on. That gives us the one thing CSS cannot: which printed page
 * a given element ended up on, identified by its id rather than by its text.
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument as PDFDocumentType,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFString,
} from "@folknor/pdf-lib";

const utf8 = new TextDecoder();

/**
 * Map every named destination in a PDF to its 1-based page number.
 *
 * Reads both the catalog's `/Dests` dictionary (what Chromium writes) and the
 * `/Names` `/Dests` name tree. A destination whose page cannot be found is
 * left out. Returns an empty map for a PDF without destinations.
 */
export async function readDestinations(
  pdfBytes: Buffer | Uint8Array,
): Promise<Map<string, number>> {
  const doc = await PDFDocument.load(new Uint8Array(pdfBytes));

  // Destinations reference page objects, so we need a ref -> index lookup.
  const pageIndexByRef = new Map<string, number>();

  doc.getPages().forEach((page, i) => {
    pageIndexByRef.set(page.ref.toString(), i + 1);
  });

  const pages = new Map<string, number>();

  const add = (name: string, dest: PDFObject | undefined): void => {
    const page = destinationPage(doc, dest, pageIndexByRef);

    if (page !== undefined && !pages.has(name)) {
      pages.set(name, page);
    }
  };

  const dests = doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);

  if (dests) {
    for (const [key, value] of dests.entries()) {
      add(utf8.decode(key.asBytes()), value);
    }
  }

  const tree = doc.catalog
    .lookupMaybe(PDFName.of("Names"), PDFDict)
    ?.lookupMaybe(PDFName.of("Dests"), PDFDict);

  if (tree) {
    walkNameTree(tree, add, new Set());
  }

  return pages;
}

/** Visit every leaf of a name tree, following `/Kids`. */
function walkNameTree(
  node: PDFDict,
  add: (name: string, dest: PDFObject | undefined) => void,
  visited: Set<PDFDict>,
): void {
  if (visited.has(node)) {
    return;
  }

  visited.add(node);

  const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);

  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const key = names.lookup(i);

      if (key instanceof PDFString || key instanceof PDFHexString) {
        add(key.decodeText(), names.get(i + 1));
      }
    }
  }

  const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);

  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);

      if (kid instanceof PDFDict) {
        walkNameTree(kid, add, visited);
      }
    }
  }
}

/** The 1-based page of an explicit destination, or of a `<< /D [...] >>` wrapper. */
function destinationPage(
  doc: PDFDocumentType,
  dest: PDFObject | undefined,
  pageIndexByRef: ReadonlyMap<string, number>,
): number | undefined {
  const resolved = dest === undefined ? undefined : doc.context.lookup(dest);

  const array =
    resolved instanceof PDFDict
      ? resolved.lookupMaybe(PDFName.of("D"), PDFArray)
      : resolved instanceof PDFArray
        ? resolved
        : undefined;

  const target = array?.get(0);

  return target ? pageIndexByRef.get(target.toString()) : undefined;
}
