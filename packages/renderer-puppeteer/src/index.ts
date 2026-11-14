// Puppeteer-based renderer for mdforge

// Re-export everything from @mdforge/core for convenience
export {
  type Config,
  defaultConfig,
  type Theme,
  themes,
} from "@mdforge/core";

export {
  type ConversionInfo,
  formatConversionInfo,
} from "@mdforge/core/conversion-info";

export {
  ConfigError,
  FileNotFoundError,
  GenerationError,
  IncludeError,
  MdforgeError,
} from "@mdforge/core/errors";

export {
  type FontConfig,
  type FontPairing,
  fontPairings,
} from "@mdforge/core/fonts";

export type { TemplatesConfig } from "@mdforge/core/includes";

// Export prepare types
export {
  type ConvertOptions,
  type PreparedConversion,
  prepareConversion,
  type StylesheetEntry,
} from "@mdforge/core/prepare";

export { resolveFileRefs } from "@mdforge/core/util";

export type { PdfMetadata } from "@mdforge/pdf";

// Export backward-compatible convertMdToPdf
export { type ConvertResult, convertMdToPdf } from "./convert.js";

// Export render function
export { closeBrowser, type RenderResult, render } from "./render.js";
