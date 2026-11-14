import GithubSlugger, { slug } from "github-slugger";
import { transliterate } from "transliteration";

const unescapeTest = /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/gi;

/**
 * Decode HTML entities in a string.
 */
function decodeHtmlEntities(html: string): string {
  return html.replace(unescapeTest, (_, n: string) => {
    n = n.toLowerCase();

    if (n === "colon") return ":";

    if (n.charAt(0) === "#") {
      return n.charAt(1) === "x"
        ? String.fromCharCode(Number.parseInt(n.substring(2), 16))
        : String.fromCharCode(Number(n.substring(1)));
    }

    return "";
  });
}

/**
 * Clean text for slug generation: unescape HTML entities, strip HTML tags,
 * and transliterate Unicode to ASCII for CSS selector compatibility.
 */
export function cleanForSlug(text: string): string {
  const cleaned = decodeHtmlEntities(text)
    .trim()
    .replace(/<[!/a-z].*?>/gi, "");

  // Transliterate Unicode to ASCII (e.g., å→a, ø→o, ñ→n)
  return transliterate(cleaned);
}

/**
 * Hands out heading ids for one rendered document, de-duplicating repeats as
 * GitHub does (`notes`, `notes-1`, ...). The input is the heading's rendered
 * inline HTML. A heading whose text yields no slug at all (empty, or only
 * punctuation) is called `section`, through the same de-duplication, so its
 * TOC link never degenerates to `#`.
 */
export class HeadingIdAssigner {
  private readonly slugger = new GithubSlugger();

  public assign(renderedText: string): string {
    const cleaned = cleanForSlug(renderedText);

    return this.slugger.slug(slug(cleaned) ? cleaned : "section");
  }
}

/**
 * The id a cross-reference argument (`@see`, `@pageof`, `@numberof`,
 * `@anchor`) names. Each reference is slugged on its own, without
 * de-duplication: a later repeated heading is named by its suffixed id, as in
 * `@pageof(Notes-1)`.
 */
export function referenceSlug(name: string): string {
  return slug(cleanForSlug(name.trim()));
}
