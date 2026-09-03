/**
 * Backward-compatible conversion function.
 *
 * This wraps prepareConversion() from @mdforge/core and render() from this package
 * to provide the same API as the original convertMdToPdf().
 */

import { promises as fs } from "node:fs";
import process from "node:process";
import type { Config, ConversionInfo } from "@mdforge/core";
import { GenerationError } from "@mdforge/core/errors";
import { type ConvertOptions, prepareConversion } from "@mdforge/core/prepare";
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
 * @param options - Optional arguments and browser instance
 * @returns The conversion result
 */
export async function convertMdToPdf(
  input: { path: string } | { content: string },
  config: Config,
  {
    args = {},
    browser,
  }: {
    args?: ConvertOptions;
    browser?: Browser;
  } = {},
): Promise<ConvertResult> {
  // Prepare the conversion (no browser needed)
  const prepared = await prepareConversion(input, config, args);

  // Render the document
  let output: Awaited<ReturnType<typeof render>>;
  try {
    output = await render(prepared, browser);

    // Page references need a laid-out PDF before they can be resolved, so
    // read the outline back and render again with the real numbers in place.
    if (!prepared.config.as_html && hasPageRefs(prepared.html)) {
      for (let pass = 1; pass < MAX_PAGEREF_PASSES; pass++) {
        const outline = await readOutline(
          output.content as Buffer | Uint8Array,
        );
        const headingPages = new Map(
          outline.map((entry) => [entry.title, entry.page] as const),
        );
        const resolved = resolvePageRefs(prepared.html, headingPages);
        if (!resolved.changed) {
          break;
        }
        prepared.html = resolved.html;
        output = await render(prepared, browser);
      }
    }
  } catch (error) {
    const err = error as Error;
    const outputType = prepared.config.as_html ? "HTML" : "PDF";
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
    throw new GenerationError(
      `Failed to create ${outputType}: ${err.message}`,
      err,
    );
  }

  // Write output file if destination is set
  if (prepared.dest) {
    if (prepared.dest === "stdout") {
      process.stdout.write(output.content);
    } else {
      await fs.writeFile(prepared.dest, output.content);
    }
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
