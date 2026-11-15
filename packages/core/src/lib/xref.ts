import { escapeHtml } from "./util.ts";
import { referenceSlug } from "./slugger.ts";

/**
 * Cross-reference processing for mdforge.
 *
 * @see(Section Name) → [Section Name](#section-name)
 * @anchor(Custom Point) → <a id="custom-point"></a>
 * @pageof(Section Name) → the printed page number that heading lands on
 *
 * `@numberof(...)` is not here: it is resolved by the heading renderer
 * (outline.ts), which is what hands out heading ids and numbers.
 */

/**
 * Regex to match @see(...) references (not inside backticks)
 */
const XREF_REGEX = /(?<!`)@see\(([^)]+)\)/g;

/**
 * Regex to match @anchor(...) definitions (not inside backticks)
 */
const ANCHOR_REGEX = /(?<!`)@anchor\(([^)]+)\)/g;

/**
 * Regex to match @pageof(...) references (not inside backticks)
 */
const PAGEOF_REGEX = /(?<!`)@pageof\(([^)]+)\)/g;

/** Attribute holding the slug a page reference points at. */
export const PAGEREF_ATTR = "data-mdforge-pageref";

/**
 * Placeholder shown before the page number is known. Two characters wide, so
 * the resolved number rarely changes line breaking on the second pass.
 */
const PAGEREF_PLACEHOLDER = "??";

/**
 * Markup for one unresolved page reference pointing at `slug`.
 *
 * Exported so generators that run *after* {@link processXref} (the TOC, which
 * is expanded during markdown-to-HTML conversion) can emit page references
 * directly instead of `@pageof(...)` text that would never be processed.
 *
 * The span carries a hidden link to `#slug`. Chromium writes a named PDF
 * destination for every element an in-document link points at, hidden links
 * included, and that destination is how the page is found afterwards: by the
 * target's id, never by its title. Being `display: none`, the link adds no
 * annotation, no tagged `Link` element and no visible text.
 */
export function pageRefSpan(slug: string): string {
  const target = `<a href="#${escapeHtml(slug)}" style="display:none" aria-hidden="true"></a>`;

  return `<span class="mdforge-pageref" ${PAGEREF_ATTR}="${escapeHtml(slug)}">${target}${PAGEREF_PLACEHOLDER}</span>`;
}

/**
 * Process cross-references and anchors in markdown content.
 * - @see Section Name → [Section Name](#section-name)
 * - @anchor Custom Point → <a id="custom-point"></a>
 */
export function processXref(content: string): string {
  // Process @anchor definitions first
  let result = content.replace(ANCHOR_REGEX, (_match, anchorName: string) => {
    const trimmed = anchorName.trim();
    const slug = referenceSlug(trimmed);

    return `<a id="${escapeHtml(slug)}"></a>`;
  });

  // Process @see references
  result = result.replace(XREF_REGEX, (_match, sectionName: string) => {
    const trimmed = sectionName.trim();
    const slug = referenceSlug(trimmed);

    return `[${trimmed}](#${slug})`;
  });

  // Process @pageof references. The real number is only knowable once the PDF
  // has been laid out, so emit a placeholder the renderer fills in afterwards.
  result = result.replace(PAGEOF_REGEX, (_match, sectionName: string) =>
    pageRefSpan(referenceSlug(sectionName.trim())),
  );

  return result;
}

/** True when the document contains at least one unresolved page reference. */
export function hasPageRefs(html: string): boolean {
  return html.includes(`${PAGEREF_ATTR}="`);
}

/** One page-reference span as the loaded page shows it. */
export interface ShownPageRef {
  slug: string;
  /** The number text after the hidden target link */
  text: string;
}

/** Result of one page-reference resolution pass. */
export interface PageRefResolution {
  /** The text every reference to a slug should show */
  texts: Map<string, string>;
  /** False once the page numbers have settled. */
  changed: boolean;
  /** Slugs of references no destination answered for, each listed once. */
  unresolved: string[];
}

/**
 * Work out the page numbers the references a page shows should have.
 *
 * `pageById` maps element ids to the 1-based page they landed on, as read from
 * the PDF's named destinations. Each reference's slug is the id of its target,
 * so it is looked up exactly: the second of two "Notes" headings (id
 * `notes-1`) gets its own page, and a heading literally titled "Notes-1" (id
 * `notes-1-1`) gets its. Titles are never consulted - an earlier design matched
 * outline titles and so confused repeated and numbered headings.
 *
 * A reference with no destination is reset to the `??` placeholder, so a
 * number from an earlier pass never survives once its target is gone.
 *
 * `changed` compares against what the page actually shows, so an unchanged
 * result means the numbers have settled and no further pass is needed.
 */
export function resolvePageRefs(
  shown: readonly ShownPageRef[],
  pageById: ReadonlyMap<string, number>,
): PageRefResolution {
  const texts = new Map<string, string>();
  const unresolved = new Set<string>();
  let changed = false;

  for (const { slug, text } of shown) {
    const page = pageById.get(slug);

    if (page === undefined) {
      unresolved.add(slug);
    }

    const wanted = page === undefined ? PAGEREF_PLACEHOLDER : String(page);
    texts.set(slug, wanted);

    if (wanted !== text) {
      changed = true;
    }
  }

  return { texts, changed, unresolved: [...unresolved] };
}

/**
 * Browser-side: the page-reference spans in the page, in document order.
 * Self-contained, for evaluation in the page.
 */
export function readShownPageRefs(attr: string): ShownPageRef[] {
  return Array.from(document.querySelectorAll(`[${attr}]`), (span) => {
    const last = span.lastChild;

    return {
      slug: span.getAttribute(attr) ?? "",
      text: last?.nodeType === Node.TEXT_NODE ? (last.nodeValue ?? "") : "",
    };
  });
}

/**
 * Browser-side: set the number text of every page-reference span whose slug
 * has an entry, keeping the hidden target link. Self-contained, for evaluation
 * in the page.
 */
export function writeShownPageRefs({
  attr,
  texts,
}: {
  attr: string;
  texts: Array<[string, string]>;
}): void {
  const bySlug = new Map(texts);

  for (const span of Array.from(document.querySelectorAll(`[${attr}]`))) {
    const text = bySlug.get(span.getAttribute(attr) ?? "");

    if (text === undefined) continue;

    for (const node of Array.from(span.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) span.removeChild(node);
    }

    span.appendChild(document.createTextNode(text));
  }
}
