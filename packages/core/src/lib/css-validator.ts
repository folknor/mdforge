import postcss from "postcss";

export interface CssValidationResult {
	valid: boolean;
	errors: CssError[];
}

export interface CssError {
	message: string;
	line?: number;
	column?: number;
}

/**
 * Validate CSS syntax using PostCSS parser.
 *
 * This catches structural errors like:
 * - Unclosed brackets/braces
 * - Unclosed strings
 * - Invalid syntax structure
 *
 * It does NOT validate:
 * - Property names (typos like "colr" pass)
 * - Property values (invalid values pass)
 * - Selectors (invalid selectors pass)
 */
export function validateCss(css: string, filename?: string): CssValidationResult {
	const errors: CssError[] = [];

	try {
		postcss.parse(css, { from: filename });
	} catch (error) {
		if (error && typeof error === "object" && "name" in error) {
			const cssError = error as {
				name: string;
				message: string;
				reason?: string;
				line?: number;
				column?: number;
			};

			if (cssError.name === "CssSyntaxError") {
				errors.push({
					message: cssError.reason || cssError.message,
					line: cssError.line,
					column: cssError.column,
				});
			} else {
				errors.push({ message: String(error) });
			}
		} else {
			errors.push({ message: String(error) });
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Format CSS validation errors for display
 */
export function formatCssErrors(
	errors: CssError[],
	filename?: string,
): string[] {
	return errors.map((error) => {
		const location =
			error.line !== undefined
				? ` (line ${error.line}${error.column !== undefined ? `:${error.column}` : ""})`
				: "";
		const file = filename ? `${filename}${location}` : location.trim();
		return file ? `${file}: ${error.message}` : error.message;
	});
}
