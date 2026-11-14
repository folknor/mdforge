import { type Config, themes } from "./config.js";
import { fontPairings } from "./fonts.js";

interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

/** Expected shape of one top-level config key. */
interface SchemaEntry {
  /** `|`-separated kinds: string, number, boolean, array, object */
  type: string;
  values?: readonly string[];
}

/** Any value a top-level config key can hold. */
type ConfigValue = Config[keyof Config];

/**
 * Known config keys and their expected types
 */
const CONFIG_SCHEMA = new Map<string, SchemaEntry>([
  ["as_html", { type: "boolean" }],
  ["basedir", { type: "string" }],
  ["dest", { type: "string" }],
  ["theme", { type: "string|boolean", values: [...themes, "false"] }],
  ["print_urls", { type: "boolean" }],
  ["stylesheet", { type: "string|array" }],
  ["script", { type: "array" }],
  ["document_title", { type: "string" }],
  ["body_class", { type: "array" }],
  ["page_media_type", { type: "string", values: ["screen", "print"] }],
  ["code_block_style", { type: "string" }],
  ["pdf_options", { type: "object" }],
  ["launch_options", { type: "object" }],
  ["toc_options", { type: "object" }],
  ["header", { type: "string|object" }],
  ["footer", { type: "string|object" }],
  ["metadata", { type: "object" }],
  ["fonts", { type: "string|object" }],
  ["font_scale", { type: "number" }],
  ["templates", { type: "object" }],
  ["page_numbers", { type: "object" }],
  ["heading_numbers", { type: "object" }],
  ["fillable", { type: "boolean" }],
  ["constants", { type: "object" }],
  ["constants_locale", { type: "string" }],
  ["constants_precision", { type: "number" }],
]);

/*
 * Runtime guards. The config arrives from user YAML / front matter typed as
 * Config but unchecked, so these are the one place its runtime
 * representation is inspected; everything below branches on their results.
 */

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Non-null object, arrays included. */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

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
function matchesType(value: ConfigValue, typeSpec: string): boolean {
  return typeSpec.split("|").some((kind) => matchesKind(value, kind));
}

function matchesKind(value: ConfigValue, kind: string): boolean {
  switch (kind) {
    case "array":
      return Array.isArray(value);
    case "object":
      // `null` counts as an object here, as `typeof null` does
      return value === null || (isObject(value) && !Array.isArray(value));
    case "string":
      return isString(value);
    case "number":
      return isNumber(value);
    case "boolean":
      return isBoolean(value);
    default:
      return false;
  }
}

/**
 * Validate configuration and return errors
 */
export function validateConfig(config: Partial<Config>): ValidationError[] {
  const errors: ValidationError[] = [];
  const entries = new Map<string, ConfigValue>(Object.entries(config));

  // Check for unknown top-level keys
  for (const [key, value] of entries) {
    if (!CONFIG_SCHEMA.has(key)) {
      errors.push({
        path: key,
        message: `Unknown config option "${key}"`,
        value,
      });
    }
  }

  // Validate known keys
  for (const [key, schema] of CONFIG_SCHEMA) {
    const value = entries.get(key);

    if (value === undefined) continue;

    // Type check
    if (!matchesType(value, schema.type)) {
      errors.push({
        path: key,
        // `typeof` names the runtime type the user actually wrote
        message: `"${key}" should be ${schema.type}, got ${typeof value}`,
        value,
      });
      continue;
    }

    // Value check for enums
    if (schema.values && isString(value)) {
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
  if (isString(config.theme) && !themes.includes(config.theme)) {
    errors.push({
      path: "theme",
      message: `Unknown theme "${config.theme}". Available: ${themes.join(", ")}`,
      value: config.theme,
    });
  }

  // Validate pdf_options keys
  if (isObject(config.pdf_options)) {
    for (const [key, value] of Object.entries(config.pdf_options)) {
      if (!PDF_OPTIONS_KEYS.has(key)) {
        errors.push({
          path: `pdf_options.${key}`,
          message: `Unknown pdf_options key "${key}"`,
          value,
        });
      }
    }

    // Validate margin structure
    const margin = config.pdf_options.margin;

    if (isObject(margin)) {
      const validMarginKeys = new Set(["top", "right", "bottom", "left"]);

      for (const [key, value] of Object.entries(margin)) {
        if (!validMarginKeys.has(key)) {
          errors.push({
            path: `pdf_options.margin.${key}`,
            message: `Unknown margin key "${key}". Use: top, right, bottom, left`,
            value,
          });
        }
      }
    }
  }

  // Validate header/footer structure
  for (const field of ["header", "footer"] as const) {
    const fieldValue = config[field];

    if (isObject(fieldValue)) {
      const validKeys = new Set([
        "left",
        "center",
        "right",
        "background",
        "firstPage",
      ]);

      for (const [key, value] of Object.entries(fieldValue)) {
        if (!validKeys.has(key)) {
          errors.push({
            path: `${field}.${key}`,
            message: `Unknown ${field} key "${key}". Use: left, center, right`,
            value,
          });
        }
      }
    }
  }

  // Validate metadata structure
  if (isObject(config.metadata)) {
    const validMetadataKeys = new Set([
      "title",
      "author",
      "subject",
      "keywords",
      "creator",
      "producer",
    ]);

    for (const [key, value] of Object.entries(config.metadata)) {
      if (!validMetadataKeys.has(key)) {
        errors.push({
          path: `metadata.${key}`,
          message: `Unknown metadata key "${key}". Use: title, author, subject, keywords, creator, producer`,
          value,
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
    if (isString(config.fonts)) {
      // Validate preset name
      if (!(config.fonts in fontPairings)) {
        errors.push({
          path: "fonts",
          message: `Unknown font preset "${config.fonts}". Available: ${Object.keys(fontPairings).join(", ")}`,
          value: config.fonts,
        });
      }
    } else if (isObject(config.fonts)) {
      // Validate object structure
      const validFontKeys = new Set(["heading", "body", "mono"]);

      for (const [key, value] of Object.entries(config.fonts)) {
        if (!validFontKeys.has(key)) {
          errors.push({
            path: `fonts.${key}`,
            message: `Unknown fonts key "${key}". Use: heading, body, mono`,
            value,
          });
        }
      }
    }
  }

  // Validate templates structure (all values must be strings)
  if (isObject(config.templates)) {
    for (const [key, value] of Object.entries(config.templates)) {
      if (!isString(value)) {
        errors.push({
          path: `templates.${key}`,
          message: `Template "${key}" must be a string (file path)`,
          value,
        });
      }
    }
  }

  // Validate page_numbers structure
  if (isObject(config.page_numbers)) {
    const validPageNumbersKeys = new Set(["format", "start"]);

    const validFormats = [
      "arabic",
      "roman",
      "roman-upper",
      "alpha",
      "alpha-upper",
    ];

    for (const [key, value] of Object.entries(config.page_numbers)) {
      if (!validPageNumbersKeys.has(key)) {
        errors.push({
          path: `page_numbers.${key}`,
          message: `Unknown page_numbers key "${key}". Use: format, start`,
          value,
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
        !isNumber(config.page_numbers.start) ||
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
  if (isObject(config.heading_numbers)) {
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

    for (const [key, value] of Object.entries(config.heading_numbers)) {
      if (!validHeadingNumbersKeys.has(key)) {
        errors.push({
          path: `heading_numbers.${key}`,
          message: `Unknown heading_numbers key "${key}". Use: format, start_depth, max_depth, separator, skip_first_h1`,
          value,
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
        !isNumber(config.heading_numbers.start_depth) ||
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
        !isNumber(config.heading_numbers.max_depth) ||
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
      !isString(config.heading_numbers.separator)
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
      !isBoolean(config.heading_numbers.skip_first_h1)
    ) {
      errors.push({
        path: "heading_numbers.skip_first_h1",
        message: "skip_first_h1 must be a boolean",
        value: config.heading_numbers.skip_first_h1,
      });
    }
  }

  // Validate constants are flat name → number|string pairs
  if (isObject(config.constants)) {
    for (const [key, value] of Object.entries(config.constants)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        errors.push({
          path: `constants.${key}`,
          message:
            "Constant names must start with a letter or underscore and contain only letters, digits and underscores",
        });
      }

      if (!isNumber(value) && !isString(value)) {
        errors.push({
          path: `constants.${key}`,
          message: "Constants must be a number or a string",
          value,
        });
      }
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
