// Electron-based renderer for mdforge (no Puppeteer required)

// Re-export everything from @mdforge/core for convenience
export {
  type Config,
  defaultConfig,
  type PdfOptions,
  type StylesheetEntry,
  type Theme,
  themes,
} from "@mdforge/core";

export { type ConversionInfo, formatConversionInfo } from "@mdforge/core/conversion-info";

export {
  ConfigError,
  FileNotFoundError,
  GenerationError,
  IncludeError,
  MdforgeError,
} from "@mdforge/core/errors";

export {
  type FontConfig,
  type FontPairingConfig,
  type FontPairingPreset,
  fontPairings,
  isFontPairingPreset,
} from "@mdforge/core/fonts";

export type { TemplatesConfig } from "@mdforge/core/includes";

// Export prepare types
export {
  type ConvertOptions,
  type MarkdownInput,
  type OutputFormat,
  type OutputTarget,
  type PreparedConversion,
  prepareConversion,
} from "@mdforge/core/prepare";

export {
  type ConfigIssue,
  type ConfigSource,
  type ConfigYamlOptions,
  formatConfigIssues,
  type ParsedConfig,
  parseConfigYaml,
} from "@mdforge/core/config-yaml";

export type { PdfMetadata } from "@mdforge/pdf";

// Export backward-compatible convertMdToPdf
export { type ConvertResult, convertMdToPdf } from "./convert.js";

// Export the page loader
export { open, type RenderResult } from "./render.js";
