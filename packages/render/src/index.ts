// The rendering engine shared by the mdforge renderers, and the API every
// renderer package re-exports.

export {
  type Config,
  defaultConfig,
  type LaunchSettings,
  type PdfOptions,
  type ScriptEntry,
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

export {
  type DriverPage,
  type PageDriver,
  type PageEnvironment,
  type PageValue,
  type RenderStep,
  RenderStepError,
  type RequestSink,
} from "./driver.ts";

export { convert, type ConvertResult, render, type RenderResult, VIEWPORT } from "./engine.ts";

export { type PrintMargins, type PrintSpec, printSpec } from "./print-spec.ts";
