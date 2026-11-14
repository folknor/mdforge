import GithubSlugger from "github-slugger";
import { marked } from "marked";
import { HeadingNumberer, type HeadingNumbersConfig } from "./heading-numbers.ts";
import { cleanForSlug } from "./slugger.ts";

/**
 * Cross-reference processing for mdforge.
 *
 * @see(Section Name) → [Section Name](#section-name)
 * @anchor(Custom Point) → <a id="custom-point"></a>
 * @pageof(Section Name) → the printed page number that heading lands on
 * @numberof(Section Name) → that heading's automatic number, e.g. `7.1`
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
 * Generate a slug from section name using same logic as heading IDs
 */
function generateSlug(sectionName: string): string {
  const slugger = new GithubSlugger();

  return slugger.slug(cleanForSlug(sectionName.trim()));
}

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
  result = result.replace(PAGEOF_REGEX, (_match, sectionName: string) =>
    pageRefSpan(generateSlug(sectionName.trim())),
  );

  return result;
}

/**
 * Regex to match @numberof(...) references (not inside backticks)
 */
const NUMBEROF_REGEX = /(?<!`)@numberof\(([^)]+)\)/g;

/**
 * Map every heading in `md` to its automatic number, without the trailing
 * separator (`"7.1"`, not `"7.1."`), keyed by the heading's slug.
 *
 * Headings are fed to the numberer in document order, including ones it will
 * not number, because they still move the counters and the first-h1 tracking.
 * A repeated heading text resolves to its first occurrence, matching how the
 * slugger hands the plain slug to the first heading and suffixes the rest.
 */
function headingNumbersBySlug(md: string, config: HeadingNumbersConfig): Map<string, string> {
  const slugger = new GithubSlugger();
  const numberer = new HeadingNumberer(config);
  const numbers = new Map<string, string>();

  for (const token of marked.lexer(md)) {
    if (token.type !== "heading") {
      continue;
    }

    // Slugged from the un-numbered text, exactly as the renderer builds the
    // heading id, so a reference works with the heading's visible text.
    const slug = slugger.slug(cleanForSlug(token.text));
    const prefix = numberer.next(token.depth);

    if (prefix === undefined || numbers.has(slug)) {
      continue;
    }

    // Prose writes «se punkt 7.1», so the trailing separator has to go.
    numbers.set(slug, trimTrailingSeparator(prefix, config.separator ?? "."));
  }

  return numbers;
}

/** Drop the trailing level separator from a heading number prefix. */
function trimTrailingSeparator(prefix: string, separator: string): string {
  return separator && prefix.endsWith(separator) ? prefix.slice(0, -separator.length) : prefix;
}

/**
 * Replace `@numberof(...)` with the referenced heading's automatic number.
 *
 * Unlike `@pageof`, the answer is knowable statically: the same counters the
 * renderer uses can be replayed over the markdown, so this needs no second
 * pass over the laid-out PDF.
 *
 * Runs on the *final* markdown, after includes and constants, so it sees every
 * heading the document will actually render.
 *
 * The bare number is emitted, not a link: these references are written inline
 * as «etter punkt 8.1», where the surrounding prose is the sentence and an
 * underlined link fragment in the middle of it would read as noise. Authors who
 * want a link can write `@see(...)` alongside it.
 *
 * An unresolvable reference — numbering disabled, an unnumbered heading, or a
 * slug no heading claims — is left verbatim in the output rather than silently
 * dropped. A visible `@numberof(Punkt 8)` in the PDF is a defect the author
 * will notice and fix; a blank would quietly falsify the cross-reference, which
 * is the exact hazard this directive exists to prevent.
 */
export function resolveNumberRefs(
  md: string,
  config: HeadingNumbersConfig | false | undefined,
): string {
  if (!(config && NUMBEROF_REGEX.test(md))) {
    // Also resets `lastIndex`, which the `test` above advanced on a match.
    NUMBEROF_REGEX.lastIndex = 0;

    return md;
  }

  NUMBEROF_REGEX.lastIndex = 0;

  const numbers = headingNumbersBySlug(md, config);

  return md.replace(
    NUMBEROF_REGEX,
    (match, sectionName: string) => numbers.get(generateSlug(sectionName.trim())) ?? match,
  );
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
