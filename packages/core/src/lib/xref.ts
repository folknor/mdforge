import GithubSlugger from "github-slugger";
import { cleanForSlug } from "./slugger.js";

/**
 * Cross-reference processing for mdforge.
 *
 * @see(Section Name) → [Section Name](#section-name)
 * @anchor(Custom Point) → <a id="custom-point"></a>
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

	return result;
}
