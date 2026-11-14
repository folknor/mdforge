/**
 * Backward-compatible conversion function for Electron.
 *
 * This wraps prepareConversion() from @mdforge/core and render() from this package.
 */

import process from "node:process";
import type { Config, ConversionInfo } from "@mdforge/core";
import { GenerationError } from "@mdforge/core/errors";
import { renderResolvingPageRefs } from "@mdforge/core/page-refs";
import {
  type ConvertOptions,
  type MarkdownInput,
  prepareConversion,
  writeOutput,
} from "@mdforge/core/prepare";
import { readOutline } from "@mdforge/pdf";
import { render } from "./render.js";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[renderer-electron:convert]", ...args);
  }
}

/** Output from convertMdToPdf */
export interface ConvertResult {
  /** The file written, when the output target was a file */
  filename: string | undefined;
  content: Buffer | Uint8Array | string;
  info: ConversionInfo;
}

/**
 * Convert markdown to PDF or HTML using Electron.
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format and target, fillable override
 * @returns The conversion result
 */
export async function convertMdToPdf(
  input: MarkdownInput,
  config: Config,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  log("convertMdToPdf called", "path" in input ? input.path : "(content)");

  // Prepare the conversion (no browser needed)
  log("Preparing conversion...");
  const prepared = await prepareConversion(input, config, options);
  log("Preparation complete, output:", JSON.stringify(prepared.output));

  // Render the document using Electron
  log("Starting render...");
  let output: Awaited<ReturnType<typeof render>>;

  try {
    output = await renderResolvingPageRefs(prepared, render, readOutline);
    log("Render succeeded");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log("Render failed:", err.message);
    const outputType = prepared.format.toUpperCase();
    throw new GenerationError(`Failed to create ${outputType}: ${err.message}`, err);
  }

  await writeOutput(prepared.output, output.content);

  const filename = prepared.output.kind === "file" ? prepared.output.path : undefined;

  if (filename !== undefined) {
    prepared.info.output = { path: filename };
  }

  return {
    filename,
    content: output.content,
    info: prepared.info,
  };
}
