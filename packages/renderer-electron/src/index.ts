// Electron-based renderer for mdforge (no Puppeteer required): @mdforge/render
// driven by Electron's own Chromium.

import type { Config } from "@mdforge/core";
import type { ConvertOptions, MarkdownInput, PreparedConversion } from "@mdforge/core/prepare";
import {
  convert,
  type ConvertResult,
  render as renderWith,
  type RenderResult,
} from "@mdforge/render";
import { electronDriver } from "./driver.js";

export * from "@mdforge/render";

export { electronDriver } from "./driver.js";

/**
 * Convert markdown to PDF or HTML. Needs a ready Electron app.
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format and target, fillable override
 */
export function convertMdToPdf(
  input: MarkdownInput,
  config: Config,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  return convert(electronDriver, input, config, options);
}

/** Render a prepared conversion. Needs a ready Electron app. */
export function render(prepared: PreparedConversion): Promise<RenderResult> {
  return renderWith(electronDriver, prepared);
}
