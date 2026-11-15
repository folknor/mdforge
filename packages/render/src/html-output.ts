/**
 * HTML output: the loaded page serialised once, and checked to reopen with
 * the same scripts.
 *
 * The page is serialised as Puppeteer's page.content() does it - the doctype,
 * then the root element's outerHTML - so both renderers give the same file.
 * HTML serialisation writes a script's text verbatim, so a script whose text
 * the HTML parser would end early or read differently (a `</script` inside
 * it, say, which any script added after parsing can contain) does not survive
 * a save and reopen. Rather than rewrite script text, which changes what some
 * kind of script means, the output is checked: the bytes written are parsed
 * again as a browser opening the file would (scripting enabled), and every
 * script must come back with the same text, or the conversion fails.
 */

import { defaultTreeAdapter as tree, type DefaultTreeAdapterTypes, parse } from "parse5";

/** One script element of the page, in document order. */
export interface ScriptRecord {
  namespace: string;
  type: string | undefined;
  id: string | undefined;
  src: string | undefined;
  /** Its text: the concatenated text node children */
  text: string;
}

export interface HtmlSnapshot {
  html: string;
  scripts: ScriptRecord[];
}

/**
 * Browser-side: serialise the page and record its scripts, in one go so
 * nothing can change in between. Template contents are included, at the
 * template's position. Self-contained, for evaluation via `pageCall`.
 */
export function snapshotHtml(): HtmlSnapshot {
  const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) : "";
  const scripts: ScriptRecord[] = [];

  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (!(child instanceof Element)) continue;

      if (child.localName === "script") {
        const text = Array.from(child.childNodes)
          .filter((each) => each.nodeType === Node.TEXT_NODE)
          .map((each) => each.nodeValue ?? "")
          .join("");

        scripts.push({
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

  return { html: doctype + document.documentElement.outerHTML, scripts };
}

/** The scripts of parsed HTML, in the order `snapshotHtml` records them. */
function parsedScripts(html: string): Array<{ namespace: string; text: string }> {
  const scripts: Array<{ namespace: string; text: string }> = [];

  const visit = (node: DefaultTreeAdapterTypes.ParentNode): void => {
    for (const child of tree.getChildNodes(node)) {
      if (!tree.isElementNode(child)) continue;

      if (tree.getTagName(child) === "script") {
        const text = tree
          .getChildNodes(child)
          .filter((each) => tree.isTextNode(each))
          .map((each) => tree.getTextNodeContent(each))
          .join("");

        scripts.push({ namespace: tree.getNamespaceURI(child), text });
      }

      visit("content" in child ? child.content : child);
    }
  };

  visit(parse(html));

  return scripts;
}

function describe(script: ScriptRecord, index: number): string {
  if (script.id !== undefined) return `id "${script.id}"`;

  if (script.src !== undefined) return `src "${script.src}"`;

  return `number ${index + 1} in document order`;
}

/**
 * The HTML to write for a snapshot: its text as UTF-8 will store it (an
 * unpaired surrogate becomes U+FFFD), checked to give back every script.
 * Throws when a script would not survive.
 */
export function checkedHtml(snapshot: HtmlSnapshot): string {
  const html = new TextDecoder().decode(new TextEncoder().encode(snapshot.html));
  const reopened = parsedScripts(html);

  for (const [index, script] of snapshot.scripts.entries()) {
    const again = reopened[index];

    if (again?.namespace !== script.namespace || again.text !== script.text) {
      throw new Error(
        `The page's script ${describe(script, index)} does not survive HTML serialization and reparsing (for example, its text contains "</script"), so the HTML output would not reopen as rendered.`,
      );
    }
  }

  if (reopened.length !== snapshot.scripts.length) {
    throw new Error(
      "The page's scripts do not survive HTML serialization and reparsing, so the HTML output would not reopen as rendered.",
    );
  }

  return html;
}
