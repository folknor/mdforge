/**
 * HTML output: the loaded page serialised once, and checked to reopen with
 * the same raw text in its scripts, styles and other raw-text elements.
 *
 * The page is serialised as Puppeteer's page.content() does it - the doctype,
 * then the root element's outerHTML - so both renderers give the same file.
 * HTML serialisation writes the text of a script, a style and the other
 * raw-text elements ({@link RAW_TEXT}) verbatim, so text the HTML parser would
 * end early or read differently (a `</script` in a script or a `</style` in a
 * style, say, which anything added after parsing can contain) does not survive
 * a save and reopen. Rather than rewrite that text, which changes what some
 * kind of script means, the output is checked: the bytes written are parsed
 * again as a browser opening the file would (scripting enabled), and every
 * such element must come back with the same text, or the conversion fails.
 *
 * The check is on element text only: style rules a script added through the
 * CSSOM (`insertRule`) are not in the HTML at all, and are not looked for.
 */

import { defaultTreeAdapter as tree, type DefaultTreeAdapterTypes, parse } from "parse5";

/**
 * Elements whose text HTML serialisation writes verbatim, recorded in every
 * namespace: an SVG `<style>` or `<script>` is serialised escaped and simply
 * comes back unchanged, and recording it keeps every other text change caught.
 */
const RAW_TEXT = [
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
];

/** One raw-text element of the page, in document order. */
export interface RawTextRecord {
  name: string;
  namespace: string;
  type: string | undefined;
  id: string | undefined;
  src: string | undefined;
  /** Its text: the concatenated text (and CDATA) node children */
  text: string;
}

export interface HtmlSnapshot {
  html: string;
  elements: RawTextRecord[];
}

/**
 * Browser-side: serialise the page and record its raw-text elements, in one
 * go so nothing can change in between. Template contents are included, at the
 * template's position. Self-contained, for evaluation via `pageCall`.
 */
export function snapshotHtml(): HtmlSnapshot {
  // Repeated here: the function runs in the page, without this module
  const rawText = new Set([
    "style",
    "script",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
  ]);

  const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) : "";
  const elements: RawTextRecord[] = [];

  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (!(child instanceof Element)) continue;

      if (rawText.has(child.localName)) {
        const text = Array.from(child.childNodes)
          .filter(
            (each) => each.nodeType === Node.TEXT_NODE || each.nodeType === Node.CDATA_SECTION_NODE,
          )
          .map((each) => each.nodeValue ?? "")
          .join("");

        elements.push({
          name: child.localName,
          namespace: child.namespaceURI ?? "",
          type: child.getAttribute("type") ?? undefined,
          id: child.getAttribute("id") ?? undefined,
          src: child.getAttribute("src") ?? undefined,
          text,
        });
      }

      visit(child instanceof HTMLTemplateElement ? child.content : child);
    }
  };

  visit(document);

  return { html: doctype + document.documentElement.outerHTML, elements };
}

interface ParsedRecord {
  name: string;
  namespace: string;
  text: string;
}

/** The raw-text elements of parsed HTML, in the order `snapshotHtml` records them. */
function parsedElements(html: string): ParsedRecord[] {
  const elements: ParsedRecord[] = [];

  const visit = (node: DefaultTreeAdapterTypes.ParentNode): void => {
    for (const child of tree.getChildNodes(node)) {
      if (!tree.isElementNode(child)) continue;

      const name = tree.getTagName(child);

      if (RAW_TEXT.includes(name)) {
        const text = tree
          .getChildNodes(child)
          .filter((each) => tree.isTextNode(each))
          .map((each) => tree.getTextNodeContent(each))
          .join("");

        elements.push({ name, namespace: tree.getNamespaceURI(child), text });
      }

      visit("content" in child ? child.content : child);
    }
  };

  visit(parse(html));

  return elements;
}

function describe(element: RawTextRecord, index: number): string {
  const what = element.name === "script" ? "script" : `<${element.name}> element`;

  if (element.id !== undefined) return `${what} with id "${element.id}"`;

  if (element.src !== undefined) return `${what} with src "${element.src}"`;

  return `${what} (raw-text element number ${index + 1} in document order)`;
}

/**
 * The HTML to write for a snapshot: its text as UTF-8 will store it (an
 * unpaired surrogate becomes U+FFFD), checked to give back every raw-text
 * element. Throws when one would not survive.
 */
export function checkedHtml(snapshot: HtmlSnapshot): string {
  const html = new TextDecoder().decode(new TextEncoder().encode(snapshot.html));
  const reopened = parsedElements(html);

  for (const [index, element] of snapshot.elements.entries()) {
    const again = reopened[index];

    if (
      again?.name !== element.name ||
      again.namespace !== element.namespace ||
      again.text !== element.text
    ) {
      throw new Error(
        `The page's ${describe(element, index)} does not survive HTML serialization and reparsing (for example, its text contains "</script" or "</style"), so the HTML output would not reopen as rendered.`,
      );
    }
  }

  if (reopened.length !== snapshot.elements.length) {
    throw new Error(
      "The page's scripts and styles do not survive HTML serialization and reparsing, so the HTML output would not reopen as rendered.",
    );
  }

  return html;
}
