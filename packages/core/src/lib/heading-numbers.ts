import GithubSlugger from "github-slugger";
import type { MarkedExtension } from "marked";
import { cleanForSlug } from "./slugger.js";

/**
 * Heading number format options (same as page number formats).
 */
export type HeadingNumberFormat =
	| "arabic" // 1, 2, 3 (default)
	| "roman" // i, ii, iii
	| "roman-upper" // I, II, III
	| "alpha" // a, b, c
	| "alpha-upper"; // A, B, C

export interface HeadingNumbersConfig {
	/**
	 * Format for heading numbers. Default: "arabic"
	 */
	format?: HeadingNumberFormat;
	/**
	 * Starting depth level (1-6). Headings above this level won't be numbered.
	 * Default: 2 (starts numbering at h2)
	 */
	start_depth?: number;
	/**
	 * Maximum depth level to number (1-6). Headings below this level won't be numbered.
	 * Default: 6
	 */
	max_depth?: number;
	/**
	 * Separator between number levels. Default: "."
	 */
	separator?: string;
	/**
	 * Skip numbering the first h1 (usually the document title). Default: true
	 */
	skip_first_h1?: boolean;
}

/**
 * Convert a number to roman numerals.
 */
function toRoman(num: number): string {
	const romanNumerals: [number, string][] = [
		[1000, "m"],
		[900, "cm"],
		[500, "d"],
		[400, "cd"],
		[100, "c"],
		[90, "xc"],
		[50, "l"],
		[40, "xl"],
		[10, "x"],
		[9, "ix"],
		[5, "v"],
		[4, "iv"],
		[1, "i"],
	];

	let result = "";
	let remaining = num;

	for (const [value, numeral] of romanNumerals) {
		while (remaining >= value) {
			result += numeral;
			remaining -= value;
		}
	}

	return result;
}

/**
 * Convert a number to alphabetic (a, b, c, ..., z, aa, ab, ...).
 */
function toAlpha(num: number): string {
	let result = "";
	let n = num;

	while (n > 0) {
		n--;
		result = String.fromCharCode(97 + (n % 26)) + result;
		n = Math.floor(n / 26);
	}

	return result;
}

/**
 * Format a number according to the specified format.
 */
function formatNumber(num: number, format: HeadingNumberFormat): string {
	// biome-ignore lint/nursery/noUnnecessaryConditions: switch on union type is valid
	switch (format) {
		case "roman":
			return toRoman(num);
		case "roman-upper":
			return toRoman(num).toUpperCase();
		case "alpha":
			return toAlpha(num);
		case "alpha-upper":
			return toAlpha(num).toUpperCase();
		default:
			return String(num);
	}
}

/**
 * Create a Marked extension that adds hierarchical numbering to headings.
 *
 * @param config - Configuration for heading numbering
 * @returns A MarkedExtension to be passed to marked.use()
 *
 * @example
 * ```yaml
 * heading_numbers:
 *   format: arabic      # 1.1, 1.2, 2.1 (default)
 *   start_depth: 2      # Start numbering at h2 (default)
 *   max_depth: 4        # Stop numbering at h4 (default: 6)
 *   separator: "."      # Number separator (default)
 * ```
 */
export function headingNumbers(
	config: HeadingNumbersConfig = {},
): MarkedExtension {
	const {
		format = "arabic",
		start_depth = 2,
		max_depth = 6,
		separator = ".",
		skip_first_h1 = true,
	} = config;

	const slugger = new GithubSlugger();

	// Track counters for each heading level (1-6)
	const counters = [0, 0, 0, 0, 0, 0];
	let firstH1Seen = false;

	return {
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const id = slugger.slug(cleanForSlug(text));

				// Check if this heading should be numbered
				const shouldNumber =
					depth >= start_depth &&
					depth <= max_depth &&
					!(skip_first_h1 && depth === 1 && !firstH1Seen);

				// Track first h1
				if (depth === 1) {
					firstH1Seen = true;
				}

				if (!shouldNumber) {
					return `<h${depth} id="${id}">${text}</h${depth}>\n`;
				}

				// Reset deeper level counters when a shallower heading appears
				for (let i = depth; i < 6; i++) {
					counters[i] = 0;
				}

				// Increment current level counter
				const counterIndex = depth - 1;
				counters[counterIndex] = (counters[counterIndex] ?? 0) + 1;

				// Build the number prefix from start_depth to current depth
				const numberParts: string[] = [];
				for (let i = start_depth - 1; i < depth; i++) {
					numberParts.push(formatNumber(counters[i] ?? 0, format));
				}

				const numberPrefix = numberParts.join(separator);
				const numberedText = `${numberPrefix}${separator} ${text}`;

				return `<h${depth} id="${id}">${numberedText}</h${depth}>\n`;
			},
		},
	};
}
