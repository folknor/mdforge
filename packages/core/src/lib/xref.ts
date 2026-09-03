import GithubSlugger from "github-slugger";
import { cleanForSlug } from "./slugger.js";

/**
 * Cross-reference processing for mdforge.
 *
 * @see(Section Name) → [Section Name](#section-name)
 * @anchor(Custom Point) → <a id="custom-point"></a>
 * @pageof(Section Name) → the printed page number that heading lands on
 *
 * Uses the same slug logic as heading IDs for consistency.
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

/** Matches one rendered page-reference span, capturing its slug and body. */
const PAGEREF_SPAN_REGEX = new RegExp(
  `(<span[^>]*\\b${PAGEREF_ATTR}="([^"]+)"[^>]*>)([^<]*)</span>`,
  "g",
);

/**
 * Generate a slug from section name using same logic as heading IDs
 */
function generateSlug(sectionName: string): string {
  const slugger = new GithubSlugger();
  return slugger.slug(cleanForSlug(sectionName.trim()));
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
    const slug = generateSlug(trimmed);
    return `<a id="${slug}"></a>`;
  });

  // Process @see references
  result = result.replace(XREF_REGEX, (_match, sectionName: string) => {
    const trimmed = sectionName.trim();
    const slug = generateSlug(trimmed);
    return `[${trimmed}](#${slug})`;
  });

  // Process @pageof references. The real number is only knowable once the PDF
  // has been laid out, so emit a placeholder the renderer fills in afterwards.
  result = result.replace(PAGEOF_REGEX, (_match, sectionName: string) => {
    const slug = generateSlug(sectionName.trim());
    return `<span class="mdforge-pageref" ${PAGEREF_ATTR}="${slug}">${PAGEREF_PLACEHOLDER}</span>`;
  });

  return result;
}

/** True when the document contains at least one unresolved page reference. */
export function hasPageRefs(html: string): boolean {
  return html.includes(`${PAGEREF_ATTR}="`);
}

/**
 * Fill resolved page numbers into the placeholders left by `@pageof(...)`.
 *
 * `headingPages` maps heading text to its 1-based page, as read from the PDF
 * outline. Headings are matched by slug, the same way `@see` links are, so a
 * reference works with the heading's visible text.
 *
 * Returns the updated HTML and whether anything actually changed. An unchanged
 * result means the numbers have settled and no further pass is needed.
 */
export function resolvePageRefs(
  html: string,
  headingPages: Map<string, number>,
): { html: string; changed: boolean } {
  const pageBySlug = new Map<string, number>();
  for (const [title, page] of headingPages) {
    const slug = generateSlug(title);
    // A repeated heading resolves to its first occurrence.
    if (!pageBySlug.has(slug)) {
      pageBySlug.set(slug, page);
    }
  }

  let changed = false;
  const updated = html.replace(
    PAGEREF_SPAN_REGEX,
    (match, open: string, slug: string, body: string) => {
      const page = pageBySlug.get(slug);
      if (page === undefined) {
        return match;
      }
      const text = String(page);
      if (text === body) {
        return match;
      }
      changed = true;
      return `${open}${text}</span>`;
    },
  );

  return { html: updated, changed };
}
