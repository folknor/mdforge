import GithubSlugger from "github-slugger";
import type { MarkedExtension } from "marked";
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
 * Exported for use by toc.ts to ensure consistent slug generation.
 */
export function cleanForSlug(text: string): string {
	const cleaned = decodeHtmlEntities(text)
		.trim()
		.replace(/<[!/a-z].*?>/gi, "");
	// Transliterate Unicode to ASCII (e.g., å→a, ø→o, ñ→n)
	return transliterate(cleaned);
}

/**
 * Add `id` attribute to headings (h1, h2, h3, etc) like GitHub.
 * Handles duplicate headings by appending -1, -2, etc.
 *
 * @returns A {@link MarkedExtension} to be passed to {@link marked.use | `marked.use()`}
 */
export function gfmHeadingId(): MarkedExtension {
	const slugger = new GithubSlugger();

	return {
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const id = slugger.slug(cleanForSlug(text));
				return `<h${depth} id="${id}">${text}</h${depth}>\n`;
			},
		},
	};
}
