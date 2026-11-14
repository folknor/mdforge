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
import { hasPageRefs, resolvePageRefs } from "@mdforge/core/xref";
import { readOutline } from "@mdforge/pdf";
import type { Browser } from "puppeteer";
import { render } from "./render.js";

/**
 * How many times to re-render while page references settle.
 *
 * Filling in a number can change line breaking and therefore pagination, which
 * can change the number. In practice one extra pass is enough; the cap stops a
 * pathological document from looping.
 */
const MAX_PAGEREF_PASSES = 3;

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
    output = await render(prepared, browser);

    // Page references need a laid-out PDF before they can be resolved, so
    // read the outline back and render again with the real numbers in place.
    if (prepared.format === "pdf" && hasPageRefs(prepared.html)) {
      for (let pass = 1; pass < MAX_PAGEREF_PASSES; pass++) {
        // Buffer extends Uint8Array, so this only rejects HTML output, which
        // the format check above already rules out.
        if (!(output.content instanceof Uint8Array)) {
          throw new Error("Expected PDF output while resolving page references");
        }

        const outline = await readOutline(output.content);

        const headingPages = new Map(outline.map((entry) => [entry.title, entry.page] as const));

        const resolved = resolvePageRefs(prepared.html, headingPages);

        if (!resolved.changed) {
          break;
        }

        prepared.html = resolved.html;
        output = await render(prepared, browser);
      }
    }
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
