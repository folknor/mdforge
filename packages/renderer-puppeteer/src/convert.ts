/**
 * Backward-compatible conversion function.
 *
 * This wraps prepareConversion() from @mdforge/core and render() from this package
 * to provide the same API as the original convertMdToPdf().
 */

import type { Config, ConversionInfo } from "@mdforge/core";
import { GenerationError } from "@mdforge/core/errors";
import {
  type ConvertOptions,
  type MarkdownInput,
  prepareConversion,
  writeOutput,
} from "@mdforge/core/prepare";
import { renderResolvingPageRefs } from "@mdforge/core/page-refs";
import { readOutline } from "@mdforge/pdf";
import type { Browser } from "puppeteer";
import { render } from "./render.js";

/** Output from convertMdToPdf */
export interface ConvertResult {
  /** The file written, when the output target was a file */
  filename: string | undefined;
  content: Buffer | Uint8Array | string;
  info: ConversionInfo;
}

/**
 * Convert markdown to PDF or HTML.
 *
 * This is the main entry point for CLI and other consumers.
 * It combines preparation (from @mdforge/core) with rendering (from this package).
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format and target, fillable override, and browser
 * @returns The conversion result
 */
export async function convertMdToPdf(
  input: MarkdownInput,
  config: Config,
  { browser, ...options }: ConvertOptions & { browser?: Browser } = {},
): Promise<ConvertResult> {
  // Prepare the conversion (no browser needed)
  const prepared = await prepareConversion(input, config, options);

  // Render the document
  let output: Awaited<ReturnType<typeof render>>;

  try {
    output = await renderResolvingPageRefs(prepared, (pass) => render(pass, browser), readOutline);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const outputType = prepared.format.toUpperCase();

    // Provide context about what failed
    if (err.message.includes("Browser") || err.message.includes("browser")) {
      throw new GenerationError(
        `Failed to create ${outputType}: Could not launch browser. Is Puppeteer installed correctly?`,
        err,
      );
    }

    if (err.message.includes("timeout") || err.message.includes("Timeout")) {
      throw new GenerationError(
        `Failed to create ${outputType}: Page load timed out. Check for slow-loading resources.`,
        err,
      );
    }

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
