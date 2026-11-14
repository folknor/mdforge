/**
 * Backward-compatible conversion function for Electron.
 *
 * This wraps prepareConversion() from @mdforge/core and render() from this package.
 */

import { promises as fs } from "node:fs";
import process from "node:process";
import type { Config, ConversionInfo } from "@mdforge/core";
import { GenerationError } from "@mdforge/core/errors";
import { type ConvertOptions, prepareConversion } from "@mdforge/core/prepare";
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
  filename: string | undefined;
  content: Buffer | Uint8Array | string;
  info: ConversionInfo;
}

/**
 * Convert markdown to PDF or HTML using Electron.
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Optional arguments
 * @returns The conversion result
 */
export async function convertMdToPdf(
  input: { path: string } | { content: string },
  config: Config,
  {
    args = {},
  }: {
    args?: ConvertOptions;
  } = {},
): Promise<ConvertResult> {
  log("convertMdToPdf called", "path" in input ? input.path : "(content)");
  log("Config dest:", config.dest);

  // Prepare the conversion (no browser needed)
  log("Preparing conversion...");
  const prepared = await prepareConversion(input, config, args);
  log("Preparation complete, dest:", prepared.dest);

  // Render the document using Electron
  log("Starting render...");
  let output: Awaited<ReturnType<typeof render>>;

  try {
    output = await render(prepared);
    log("Render succeeded");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log("Render failed:", err.message);
    const outputType = prepared.config.as_html ? "HTML" : "PDF";
    throw new GenerationError(
      `Failed to create ${outputType}: ${err.message}`,
      err,
    );
  }

  // Write output file if destination is set
  if (prepared.dest) {
    log("Writing output to:", prepared.dest);

    if (prepared.dest === "stdout") {
      process.stdout.write(output.content);
    } else {
      await fs.writeFile(prepared.dest, output.content);
    }

    log("Output written");
  }

  // Track output info
  if (prepared.dest) {
    prepared.info.output = {
      path: prepared.dest,
    };
  }

  return {
    filename: prepared.dest,
    content: output.content,
    info: prepared.info,
  };
}
