/**
 * @mdforge/core - Core library for mdforge
 *
 * This package handles markdown processing, configuration, themes, and fonts.
 * It does NOT include browser rendering - use @mdforge/renderer-puppeteer or
 * @mdforge/renderer-electron for PDF generation.
 */

// PDF types (re-exported from @mdforge/pdf)
export type { PdfMetadata } from "@mdforge/pdf";
// Configuration types and defaults
export {
  type Config,
  defaultConfig,
  type Theme,
  themes,
} from "./lib/config.js";
// Document constants
export type { ConstantValue } from "./lib/constants.js";
// Conversion info for CLI output
export {
  type ConversionInfo,
  formatConversionInfo,
} from "./lib/conversion-info.js";
// Error types
export {
  ConfigError,
  FileNotFoundError,
  GenerationError,
  IncludeError,
  MdforgeError,
} from "./lib/errors.js";
// Font configuration
export {
  type EmbeddedFontData,
  type FontConfig,
  type FontPairing,
  fontPairings,
} from "./lib/fonts.js";
// Include templates
export type { TemplatesConfig } from "./lib/includes.js";
// Preparation function (the main API for renderers)
export {
  type ConvertOptions,
  type PreparedConversion,
  prepareConversion,
  type StylesheetEntry,
} from "./lib/prepare.js";
// Utilities
export { resolveFileRefs } from "./lib/util.js";
