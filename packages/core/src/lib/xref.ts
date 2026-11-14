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
 * Matches one rendered page-reference span, capturing its opening (the span
 * tag plus its hidden target link, which every pass must keep), its slug, and
 * the number text that is replaced.
 */
const PAGEREF_SPAN_REGEX = new RegExp(
  `(<span[^>]*\\b${PAGEREF_ATTR}="([^"]+)"[^>]*>(?:<a [^>]*></a>)?)([^<]*)</span>`,
  "g",
);

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
  const target = `<a href="#${slug}" style="display:none" aria-hidden="true"></a>`;

  return `<span class="mdforge-pageref" ${PAGEREF_ATTR}="${slug}">${target}${PAGEREF_PLACEHOLDER}</span>`;
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

    return `<a id="${slug}"></a>`;
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

/** Result of one page-reference resolution pass. */
export interface PageRefResolution {
  html: string;
  /** False once the page numbers have settled. */
  changed: boolean;
  /** Slugs of references no destination answered for, each listed once. */
  unresolved: string[];
}

/**
 * Fill resolved page numbers into the placeholders left by `@pageof(...)` and
 * the TOC.
 *
 * `pageById` maps element ids to the 1-based page they landed on, as read from
 * the PDF's named destinations. Each placeholder's slug is the id of its
 * target, so it is looked up exactly: the second of two "Notes" headings (id
 * `notes-1`) gets its own page, and a heading literally titled "Notes-1" (id
 * `notes-1-1`) gets its. Titles are never consulted - an earlier design matched
 * outline titles and so confused repeated and numbered headings.
 *
 * A reference with no destination is reset to the `??` placeholder, so a
 * number from an earlier pass never survives once its target is gone.
 *
 * Returns the updated HTML, whether anything actually changed, and the
 * references left unresolved. An unchanged result means the numbers have
 * settled and no further pass is needed.
 */
export function resolvePageRefs(
  html: string,
  pageById: ReadonlyMap<string, number>,
): PageRefResolution {
  let changed = false;
  const unresolved = new Set<string>();

  const updated = html.replace(
    PAGEREF_SPAN_REGEX,
    (match, open: string, slug: string, body: string) => {
      const page = pageById.get(slug);

      if (page === undefined) {
        unresolved.add(slug);
      }

      const text = page === undefined ? PAGEREF_PLACEHOLDER : String(page);

      if (text === body) {
        return match;
      }

      changed = true;

      return `${open}${text}</span>`;
    },
  );

  return { html: updated, changed, unresolved: [...unresolved] };
}
