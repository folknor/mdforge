import GithubSlugger from "github-slugger";
import { marked } from "marked";
import {
  HeadingNumberer,
  type HeadingNumbersConfig,
} from "./heading-numbers.js";
import { cleanForSlug } from "./slugger.js";

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
 * Markup for one unresolved page reference pointing at `slug`.
 *
 * Exported so generators that run *after* {@link processXref} (the TOC, which
 * is expanded during markdown-to-HTML conversion) can emit page references
 * directly instead of `@pageof(...)` text that would never be processed.
 */
export function pageRefSpan(slug: string): string {
  return `<span class="mdforge-pageref" ${PAGEREF_ATTR}="${slug}">${PAGEREF_PLACEHOLDER}</span>`;
}

/**
 * Strip a leading heading number such as `8. `, `2.3. `, `A) ` or `iv. `
 * from a title. Returns `undefined` when there is nothing to strip.
 *
 * Only labels a list actually produces are recognised: digits (possibly
 * dotted), a single letter, or a roman numeral. Anything broader would eat
 * real words — "NB. Viktig" is a title, not a numbered heading.
 */
function stripHeadingNumber(title: string): string | undefined {
  // The roman branch comes first so "ii. " strips as a numeral rather than
  // leaving "i. " behind; a single letter that is also a roman digit (i, v,
  // x, …) strips identically either way, so the overlap is harmless.
  const stripped = title.replace(
    /^(?:[0-9]+(?:[.)][0-9]+)*|[ivxlcdm]+|[a-z])[.)]\s+/i,
    "",
  );
  return stripped === title || stripped.length === 0 ? undefined : stripped;
}

/**
 * Undo Chrome's doubled outline titles.
 *
 * A heading that lands against a page boundary is sometimes written to the
 * outline with its text repeated verbatim ("2. Intro2. Intro"), which no slug
 * can match. Only an exact two-halves repeat is undone, so a heading genuinely
 * named "blahblah" is left alone. Returns `undefined` when nothing was doubled.
 */
function numberedHalf(title: string): string | undefined {
  const half = undoubleTitle(title);
  // Chrome repeats the *rendered* title, heading number included, so a half
  // without a leading label is a real heading rather than a doubled one.
  return half !== undefined && stripHeadingNumber(half) !== undefined
    ? half
    : undefined;
}

/** The first half of an exact two-halves repeat, or `undefined`. */
function undoubleTitle(title: string): string | undefined {
  if (title.length < 2 || title.length % 2 !== 0) {
    return undefined;
  }
  const half = title.length / 2;
  const first = title.slice(0, half);
  return first === title.slice(half) ? first : undefined;
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
function headingNumbersBySlug(
  md: string,
  config: HeadingNumbersConfig,
): Map<string, string> {
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
  return separator && prefix.endsWith(separator)
    ? prefix.slice(0, -separator.length)
    : prefix;
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
    (match, sectionName: string) =>
      numbers.get(generateSlug(sectionName.trim())) ?? match,
  );
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
  // Fallbacks for outline titles carrying an automatic heading number: the
  // heading's id is built from the un-numbered text, so "8. Avvik" in the
  // outline must also answer for the slug "avvik". Only used when no heading
  // claims that slug directly.
  const fallbackBySlug = new Map<string, number>();
  const addFallback = (title: string, page: number): void => {
    const slug = generateSlug(title);
    if (!fallbackBySlug.has(slug)) {
      fallbackBySlug.set(slug, page);
    }
  };
  for (const [title, page] of headingPages) {
    const slug = generateSlug(title);
    // A repeated heading resolves to its first occurrence.
    if (!pageBySlug.has(slug)) {
      pageBySlug.set(slug, page);
    }
    // Both manglings can apply at once: Chrome doubles a numbered heading as
    // "3.1. Late3.1. Late", which has to be undoubled before the number strips.
    // Only a numbered half counts as doubling — otherwise a heading genuinely
    // named "blahblah" would claim the slug "blah" and answer for it wrongly.
    const undoubled = numberedHalf(title);
    if (undoubled !== undefined) {
      addFallback(undoubled, page);
    }
    for (const variant of [title, undoubled]) {
      if (variant === undefined) {
        continue;
      }
      const unnumbered = stripHeadingNumber(variant);
      if (unnumbered !== undefined) {
        addFallback(unnumbered, page);
      }
    }
  }

  let changed = false;
  const updated = html.replace(
    PAGEREF_SPAN_REGEX,
    (match, open: string, slug: string, body: string) => {
      const page = pageBySlug.get(slug) ?? fallbackBySlug.get(slug);
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
