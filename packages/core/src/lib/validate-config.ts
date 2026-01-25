import { type Config, type Theme, themes } from "./config.js";
import { fontPairings } from "./fonts.js";

interface ValidationError {
	path: string;
	message: string;
	value?: unknown;
}

/**
 * Known config keys and their expected types
 */
const CONFIG_SCHEMA: Record<
	string,
	{ type: string; values?: readonly string[] }
> = {
	as_html: { type: "boolean" },
	basedir: { type: "string" },
	dest: { type: "string" },
	theme: { type: "string|boolean", values: [...themes, "false"] },
	print_urls: { type: "boolean" },
	stylesheet: { type: "string|array" },
	script: { type: "array" },
	document_title: { type: "string" },
	body_class: { type: "array" },
	page_media_type: { type: "string", values: ["screen", "print"] },
	code_block_style: { type: "string" },
	pdf_options: { type: "object" },
	launch_options: { type: "object" },
	toc_options: { type: "object" },
	header: { type: "string|object" },
	footer: { type: "string|object" },
	metadata: { type: "object" },
	fonts: { type: "string|object" },
	font_scale: { type: "number" },
	templates: { type: "object" },
	page_numbers: { type: "object" },
	heading_numbers: { type: "object" },
	fillable: { type: "boolean" },
};

/**
 * Known pdf_options keys (Puppeteer PDFOptions)
 */
const PDF_OPTIONS_KEYS: Set<string> = new Set([
	"path",
	"scale",
	"displayHeaderFooter",
	"headerTemplate",
	"footerTemplate",
	"printBackground",
	"landscape",
	"pageRanges",
	"format",
	"width",
	"height",
	"preferCSSPageSize",
	"margin",
	"omitBackground",
	"timeout",
	"waitForFonts",
]);

/**
 * Check if a value matches the expected type
 */
function matchesType(value: unknown, typeSpec: string): boolean {
	const types = typeSpec.split("|");
	const actualType = Array.isArray(value) ? "array" : typeof value;

	for (const t of types) {
		if (t === "array" && Array.isArray(value)) return true;
		if (t === actualType) return true;
		if (t === "boolean" && value === false) return true;
	}
	return false;
}

/**
 * Validate configuration and return errors
 */
export function validateConfig(config: Partial<Config>): ValidationError[] {
	const errors: ValidationError[] = [];

	// Check for unknown top-level keys
	for (const key of Object.keys(config)) {
		if (!(key in CONFIG_SCHEMA)) {
			errors.push({
				path: key,
				message: `Unknown config option "${key}"`,
				value: config[key as keyof Config],
			});
		}
	}

	// Validate known keys
	for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
		const value = config[key as keyof Config];
		if (value === undefined) continue;

		// Type check
		if (!matchesType(value, schema.type)) {
			errors.push({
				path: key,
				message: `"${key}" should be ${schema.type}, got ${typeof value}`,
				value,
			});
			continue;
		}

		// Value check for enums
		if (schema.values && typeof value === "string") {
			if (!schema.values.includes(value)) {
				errors.push({
					path: key,
					message: `"${key}" must be one of: ${schema.values.join(", ")}`,
					value,
				});
			}
		}
	}

	// Validate theme specifically
	if (config.theme !== undefined && config.theme !== false) {
		if (
			typeof config.theme === "string" &&
			!themes.includes(config.theme as Theme)
		) {
			errors.push({
				path: "theme",
				message: `Unknown theme "${config.theme}". Available: ${themes.join(", ")}`,
				value: config.theme,
			});
		}
	}

	// Validate pdf_options keys
	if (config.pdf_options && typeof config.pdf_options === "object") {
		for (const key of Object.keys(config.pdf_options)) {
			if (!PDF_OPTIONS_KEYS.has(key)) {
				errors.push({
					path: `pdf_options.${key}`,
					message: `Unknown pdf_options key "${key}"`,
					value: config.pdf_options[key as keyof typeof config.pdf_options],
				});
			}
		}

		// Validate margin structure
		const margin = config.pdf_options.margin;
		if (
			margin !== undefined &&
			typeof margin !== "string" &&
			typeof margin === "object"
		) {
			const validMarginKeys = new Set(["top", "right", "bottom", "left"]);
			for (const key of Object.keys(margin)) {
				if (!validMarginKeys.has(key)) {
					errors.push({
						path: `pdf_options.margin.${key}`,
						message: `Unknown margin key "${key}". Use: top, right, bottom, left`,
						value: margin[key as keyof typeof margin],
					});
				}
			}
		}
	}

	// Validate header/footer structure
	for (const field of ["header", "footer"] as const) {
		const value = config[field];
		if (value && typeof value === "object") {
			const validKeys = new Set([
				"left",
				"center",
				"right",
				"background",
				"firstPage",
			]);
			for (const key of Object.keys(value)) {
				if (!validKeys.has(key)) {
					errors.push({
						path: `${field}.${key}`,
						message: `Unknown ${field} key "${key}". Use: left, center, right`,
						value: value[key as keyof typeof value],
					});
				}
			}
		}
	}

	// Validate metadata structure
	if (config.metadata && typeof config.metadata === "object") {
		const validMetadataKeys = new Set([
			"title",
			"author",
			"subject",
			"keywords",
			"creator",
			"producer",
		]);
		for (const key of Object.keys(config.metadata)) {
			if (!validMetadataKeys.has(key)) {
				errors.push({
					path: `metadata.${key}`,
					message: `Unknown metadata key "${key}". Use: title, author, subject, keywords, creator, producer`,
					value: config.metadata[key as keyof typeof config.metadata],
				});
			}
		}
		// Validate keywords is an array if present
		if (
			config.metadata.keywords !== undefined &&
			!Array.isArray(config.metadata.keywords)
		) {
			errors.push({
				path: "metadata.keywords",
				message: "metadata.keywords should be an array of strings",
				value: config.metadata.keywords,
			});
		}
	}

	// Validate font_scale is positive
	if (config.font_scale !== undefined) {
		if (config.font_scale <= 0) {
			errors.push({
				path: "font_scale",
				message: "font_scale must be a positive number",
				value: config.font_scale,
			});
		}
	}

	// Validate fonts (string preset or object config)
	if (config.fonts) {
		if (typeof config.fonts === "string") {
			// Validate preset name
			if (!(config.fonts in fontPairings)) {
				errors.push({
					path: "fonts",
					message: `Unknown font preset "${config.fonts}". Available: ${Object.keys(fontPairings).join(", ")}`,
					value: config.fonts,
				});
			}
		} else if (typeof config.fonts === "object") {
			// Validate object structure
			const validFontKeys = new Set(["heading", "body", "mono"]);
			for (const key of Object.keys(config.fonts)) {
				if (!validFontKeys.has(key)) {
					errors.push({
						path: `fonts.${key}`,
						message: `Unknown fonts key "${key}". Use: heading, body, mono`,
						value: config.fonts[key as keyof typeof config.fonts],
					});
				}
			}
		}
	}

	// Validate templates structure (all values must be strings)
	if (config.templates && typeof config.templates === "object") {
		for (const [key, value] of Object.entries(config.templates)) {
			if (typeof value !== "string") {
				errors.push({
					path: `templates.${key}`,
					message: `Template "${key}" must be a string (file path)`,
					value,
				});
			}
		}
	}

	// Validate page_numbers structure
	if (config.page_numbers && typeof config.page_numbers === "object") {
		const validPageNumbersKeys = new Set(["format", "start"]);
		const validFormats = [
			"arabic",
			"roman",
			"roman-upper",
			"alpha",
			"alpha-upper",
		];

		for (const key of Object.keys(config.page_numbers)) {
			if (!validPageNumbersKeys.has(key)) {
				errors.push({
					path: `page_numbers.${key}`,
					message: `Unknown page_numbers key "${key}". Use: format, start`,
					value: config.page_numbers[key as keyof typeof config.page_numbers],
				});
			}
		}

		// Validate format value
		if (
			config.page_numbers.format !== undefined &&
			!validFormats.includes(config.page_numbers.format)
		) {
			errors.push({
				path: "page_numbers.format",
				message: `Invalid format "${config.page_numbers.format}". Use: ${validFormats.join(", ")}`,
				value: config.page_numbers.format,
			});
		}

		// Validate start is a positive number
		if (config.page_numbers.start !== undefined) {
			if (
				typeof config.page_numbers.start !== "number" ||
				config.page_numbers.start < 1
			) {
				errors.push({
					path: "page_numbers.start",
					message: "start must be a positive number",
					value: config.page_numbers.start,
				});
			}
		}
	}

	// Validate heading_numbers structure
	if (config.heading_numbers && typeof config.heading_numbers === "object") {
		const validHeadingNumbersKeys = new Set([
			"format",
			"start_depth",
			"max_depth",
			"separator",
			"skip_first_h1",
		]);
		const validFormats = [
			"arabic",
			"roman",
			"roman-upper",
			"alpha",
			"alpha-upper",
		];

		for (const key of Object.keys(config.heading_numbers)) {
			if (!validHeadingNumbersKeys.has(key)) {
				errors.push({
					path: `heading_numbers.${key}`,
					message: `Unknown heading_numbers key "${key}". Use: format, start_depth, max_depth, separator, skip_first_h1`,
					value:
						config.heading_numbers[key as keyof typeof config.heading_numbers],
				});
			}
		}

		// Validate format value
		if (
			config.heading_numbers.format !== undefined &&
			!validFormats.includes(config.heading_numbers.format)
		) {
			errors.push({
				path: "heading_numbers.format",
				message: `Invalid format "${config.heading_numbers.format}". Use: ${validFormats.join(", ")}`,
				value: config.heading_numbers.format,
			});
		}

		// Validate start_depth is a number between 1-6
		if (config.heading_numbers.start_depth !== undefined) {
			if (
				typeof config.heading_numbers.start_depth !== "number" ||
				config.heading_numbers.start_depth < 1 ||
				config.heading_numbers.start_depth > 6
			) {
				errors.push({
					path: "heading_numbers.start_depth",
					message: "start_depth must be a number between 1 and 6",
					value: config.heading_numbers.start_depth,
				});
			}
		}

		// Validate max_depth is a number between 1-6
		if (config.heading_numbers.max_depth !== undefined) {
			if (
				typeof config.heading_numbers.max_depth !== "number" ||
				config.heading_numbers.max_depth < 1 ||
				config.heading_numbers.max_depth > 6
			) {
				errors.push({
					path: "heading_numbers.max_depth",
					message: "max_depth must be a number between 1 and 6",
					value: config.heading_numbers.max_depth,
				});
			}
		}

		// Validate separator is a string
		if (
			config.heading_numbers.separator !== undefined &&
			typeof config.heading_numbers.separator !== "string"
		) {
			errors.push({
				path: "heading_numbers.separator",
				message: "separator must be a string",
				value: config.heading_numbers.separator,
			});
		}

		// Validate skip_first_h1 is a boolean
		if (
			config.heading_numbers.skip_first_h1 !== undefined &&
			typeof config.heading_numbers.skip_first_h1 !== "boolean"
		) {
			errors.push({
				path: "heading_numbers.skip_first_h1",
				message: "skip_first_h1 must be a boolean",
				value: config.heading_numbers.skip_first_h1,
			});
		}
	}

	return errors;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return "";

	const lines = ["Configuration errors:"];
	for (const error of errors) {
		lines.push(`  - ${error.path}: ${error.message}`);
		if (error.value !== undefined) {
			const valueStr = JSON.stringify(error.value);
			if (valueStr.length < 50) {
				lines.push(`    Got: ${valueStr}`);
			}
		}
	}
	return lines.join("\n");
}
