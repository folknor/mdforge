/**
 * @mdforge/core - Core library for mdforge
 *
 * This package handles markdown processing, configuration, themes, and fonts.
 * It does NOT include browser rendering - use @mdforge/renderer-puppeteer or
 * @mdforge/renderer-electron (both built on @mdforge/render) for PDF
 * generation.
 */

// PDF types (re-exported from @mdforge/pdf)
export type { PdfMetadata } from "@mdforge/pdf";

// Configuration types and defaults
export {
  type Config,
  defaultConfig,
  type LaunchSettings,
  type PaperFormat,
  type PdfLength,
  type PdfMargin,
  type PdfOptions,
  type ScriptEntry,
  type StylesheetEntry,
  type Theme,
  themes,
} from "./lib/config.ts";

// Document constants
export type { Constant, Constants } from "./lib/constants.ts";

// Conversion info for CLI output
export { type ConversionInfo, formatConversionInfo } from "./lib/conversion-info.ts";

// Error types
export {
  ConfigError,
  FileNotFoundError,
  GenerationError,
  IncludeError,
  MdforgeError,
} from "./lib/errors.ts";

// Font configuration
export {
  type FontConfig,
  type FontPairingConfig,
  type FontPairingPreset,
  fontPairings,
  isFontPairingPreset,
} from "./lib/fonts.ts";

// Include templates
export type { TemplatesConfig } from "./lib/includes.ts";

// Preparation function (the main API for renderers)
export {
  baseElement,
  type ConvertOptions,
  type MarkdownInput,
  type OutputFormat,
  type OutputTarget,
  type PageScript,
  type PreparedConversion,
  prepareConversion,
  writeOutput,
} from "./lib/prepare.ts";

// Refusing to let one run's inputs replace each other's output files
export { OutputClaims } from "./lib/output-claims.ts";

// Output file beside a path input
export { getOutputFilePath } from "./lib/util.ts";

// Parsing user YAML (config files, front matter) into configuration
export {
  type ConfigIssue,
  type ConfigSource,
  type ConfigYamlOptions,
  formatConfigIssues,
  type ParsedConfig,
  parseConfigYaml,
} from "./lib/config-yaml.ts";
