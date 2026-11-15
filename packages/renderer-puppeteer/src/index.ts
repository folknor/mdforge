// Puppeteer-based renderer for mdforge: @mdforge/render driven by Puppeteer.

import type { Config } from "@mdforge/core";
import type { ConvertOptions, MarkdownInput, PreparedConversion } from "@mdforge/core/prepare";
import {
  convert,
  type ConvertResult,
  render as renderWith,
  type RenderResult,
} from "@mdforge/render";
import type { Browser } from "puppeteer";
import { BrowserPool, browserDriver } from "./driver.js";

export * from "@mdforge/render";

export { BrowserPool, browserDriver } from "./driver.js";

/** The pool `convertMdToPdf` and `render` use unless given a browser. */
let defaultPool = new BrowserPool();

/**
 * Convert markdown to PDF or HTML.
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format and target, fillable override, and a
 *   browser to use (and leave open) instead of the shared default one
 */
export function convertMdToPdf(
  input: MarkdownInput,
  config: Config,
  { browser, ...options }: ConvertOptions & { browser?: Browser } = {},
): Promise<ConvertResult> {
  return convert(browser ? browserDriver(browser) : defaultPool.driver, input, config, options);
}

/** Render a prepared conversion, in `browser` or the shared default one. */
export function render(prepared: PreparedConversion, browser?: Browser): Promise<RenderResult> {
  return renderWith(browser ? browserDriver(browser) : defaultPool.driver, prepared);
}

/** Close the shared default browser; the next conversion launches a new one. */
export async function closeBrowser(): Promise<void> {
  const pool = defaultPool;
  defaultPool = new BrowserPool();
  await pool.close();
}
