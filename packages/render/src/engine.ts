/**
 * The rendering engine shared by every renderer: what a prepared conversion
 * is loaded with, in what order, under which deadlines, how it is printed and
 * post-processed, and how failures are reported. A renderer supplies only a
 * PageDriver (driver.ts), so a configuration option means the same in each.
 *
 * One conversion, in order:
 *
 * 1. The driver opens a blank page with the page environment applied (viewport,
 *    `page_media_type`) and its requests routed to the remote-content load.
 * 2. The page loads core's file:// scratch page; then the configured scripts
 *    are added, then fonts are awaited - all under the remote-content deadline
 *    (`@mdforge/core/page-load`). A parse cut short by that deadline fails;
 *    stylesheets that failed to load are named in a warning.
 * 3. HTML output: the page is serialised once and checked (html-output.ts).
 *    PDF output: whole-document prints until page references settle
 *    (`@mdforge/core/page-refs`); a `pageRanges` selection is then printed
 *    and checked against them (page-ranges.ts); then form fields are read
 *    from the page, and metadata and AcroForm fields are added.
 * 4. The page is closed, and the load's warnings join the conversion's.
 *
 * Every driver call races the page's own failure, and every print (its font
 * wait included) races `pdf_options.timeout`. When a print times out, the page
 * is marked dead before it is torn down, so nothing started afterwards runs on
 * it, and the caller gets the timeout at once: teardown is not awaited.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import process from "node:process";
import { promisify } from "node:util";
import type { Config, ConversionInfo } from "@mdforge/core";
import { GenerationError } from "@mdforge/core/errors";
import type { EmbeddedFontData } from "@mdforge/core/fonts";
import {
  addPageScript,
  buildPageHtml,
  endPageLoad,
  pageCall,
  pageEndMarker,
  RemoteLoad,
  stylesheetLoadWarnings,
  truncatedPageError,
  writeScratchPage,
} from "@mdforge/core/page-load";
import { type PrintablePage, printResolvingPageRefs } from "@mdforge/core/page-refs";
import {
  type ConvertOptions,
  type MarkdownInput,
  type PreparedConversion,
  prepareConversion,
  writeOutput,
} from "@mdforge/core/prepare";
import {
  hasPageRefs,
  PAGEREF_ATTR,
  readShownPageRefs,
  writeShownPageRefs,
} from "@mdforge/core/xref";
import { addAcroFormFields, injectPdfMetadata, readPdfLayout } from "@mdforge/pdf";
import {
  type DriverPage,
  type PageDriver,
  type PageEnvironment,
  RenderStepError,
} from "./driver.ts";
import { checkedHtml, snapshotHtml } from "./html-output.ts";
import { rangedPrintMatches, selectedPages } from "./page-ranges.ts";
import {
  DEFAULT_PRINT_TIMEOUT_MS,
  type PrintSpec,
  printSpec,
  wholeDocument,
} from "./print-spec.ts";

const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) console.log("[mdforge render]", ...args);
}

/** The window every document is loaded in: Puppeteer's default viewport. */
export const VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1 } as const;

/** A rendered document. */
export interface RenderResult {
  /** The PDF, or the HTML text */
  content: Uint8Array | string;
}

/** Output from convertMdToPdf */
export interface ConvertResult {
  /** The file written, when the output target was a file */
  filename: string | undefined;
  content: Uint8Array | string;
  info: ConversionInfo;
}

/**
 * One page's lifetime. Every driver call goes through `call`, which races the
 * page's failure (and a deadline, if given) and refuses to start or finish on
 * a dead page.
 */
class Session {
  readonly page: DriverPage;
  #dead: Error | undefined;
  #closed = false;

  constructor(page: DriverPage) {
    this.page = page;
    // Observed by every call; never an unhandled rejection meanwhile
    page.failure.catch(() => undefined);
  }

  async call<T>(work: () => Promise<T>, deadline?: Promise<never>): Promise<T> {
    this.#check();

    // A synchronous throw becomes the call's rejection
    const running = (async () => work())();
    running.catch(() => undefined);

    const result = await Promise.race(
      deadline ? [running, this.page.failure, deadline] : [running, this.page.failure],
    );

    this.#check();

    return result;
  }

  /** Evaluate a self-contained browser-side function with one JSON argument. */
  async evaluate<A, R>(fn: (arg: A) => R, arg: A, deadline?: Promise<never>): Promise<Awaited<R>> {
    const result = await this.call(() => this.page.evaluate(pageCall(fn, arg)), deadline);

    // SAFETY: the source calls `fn` with `arg` in the page and the driver
    // returns its awaited result; every function evaluated this way returns
    // JSON-safe data, which both browsers transfer unchanged.
    return result as Awaited<R>;
  }

  /** Stop loading, unless the page is gone. */
  stopLoading(): ReadonlyArray<Promise<void>> {
    return this.#dead ? [] : this.page.stopLoading();
  }

  /**
   * The page cannot be used any more: mark it dead before anything else, then
   * start tearing it down without waiting.
   */
  kill(error: Error): void {
    if (this.#dead) return;
    this.#dead = error;
    this.#teardown();
  }

  async close(): Promise<void> {
    this.#dead ??= new Error("The page has been closed");

    if (this.#closed) return;
    this.#closed = true;

    try {
      await this.page.close();
    } catch {
      // Closing is cleanup; it never replaces the conversion's outcome
    }
  }

  #teardown(): void {
    if (this.#closed) return;
    this.#closed = true;

    try {
      this.page.close().catch(() => undefined);
    } catch {
      // As in close()
    }
  }

  #check(): void {
    if (this.#dead) throw this.#dead;
  }
}

/** Browser-side: settles once the page's fonts are ready. */
function fontsReady(): Promise<void> {
  return document.fonts.ready.then(() => undefined);
}

/** Load the prepared document into the page (steps 2 above). */
async function loadPage(
  session: Session,
  prepared: PreparedConversion,
  load: RemoteLoad<unknown>,
): Promise<void> {
  const marker = pageEndMarker();
  const scratch = await writeScratchPage(prepared.baseUrl, buildPageHtml(prepared, marker));
  log("loading", scratch.url);

  try {
    await load.run(
      [
        () => session.call(() => session.page.navigate(scratch.url)),
        // Configured scripts, in order, after the load event
        ...prepared.scripts.map((script) => async () => {
          await session.evaluate(addPageScript, script);
        }),
        async () => {
          await session.evaluate(fontsReady, undefined);
        },
      ],
      () => session.stopLoading(),
    );

    const end = await session.evaluate(endPageLoad, marker);

    if (load.timedOut && !end.complete) {
      throw truncatedPageError(load);
    }

    prepared.info.warnings.push(...stylesheetLoadWarnings(end));
  } finally {
    // The page is loaded (or failed); the scratch HTML is no longer needed.
    // Cleanup failures must not replace the load's own outcome.
    await scratch.dispose().catch(() => undefined);
  }
}

/**
 * One print, its font wait included, within `timeoutMs` (0: no limit). On
 * timeout the page is killed and the timeout thrown at once.
 */
async function print(session: Session, spec: PrintSpec, timeoutMs: number): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: Promise<never> | undefined;

  if (timeoutMs > 0) {
    deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(
          `Printing did not finish within ${timeoutMs / 1000} seconds (pdf_options.timeout).`,
        );

        session.kill(error);
        reject(error);
      }, timeoutMs);
    });
    deadline.catch(() => undefined);
  }

  try {
    await session.evaluate(fontsReady, undefined, deadline);

    return await session.call(() => session.page.printPdf(spec), deadline);
  } finally {
    clearTimeout(timer);
  }
}

/** Print the loaded page to the conversion's PDF (step 3 above). */
async function pdfOutput(session: Session, prepared: PreparedConversion): Promise<Uint8Array> {
  const { config } = prepared;
  const spec = printSpec(prepared.pdfOptions);
  const timeoutMs = prepared.pdfOptions.timeout ?? DEFAULT_PRINT_TIMEOUT_MS;
  let pdf: Uint8Array;

  if (hasPageRefs(prepared.html)) {
    const page: PrintablePage = {
      print: () => print(session, wholeDocument(spec), timeoutMs),
      readPageRefs: () => session.evaluate(readShownPageRefs, PAGEREF_ATTR),
      writePageRefs: async (texts) => {
        await session.evaluate(writeShownPageRefs, { attr: PAGEREF_ATTR, texts: [...texts] });
      },
    };

    const settled = await printResolvingPageRefs(prepared, page, readPdfLayout);
    pdf = settled.pdf;

    if (spec.pageRanges.trim() !== "" && settled.layout) {
      pdf = await print(session, spec, timeoutMs);
      const selected = selectedPages(spec.pageRanges, settled.layout.pageCount);

      if (!selected || !rangedPrintMatches(settled.layout, await readPdfLayout(pdf), selected)) {
        prepared.info.warnings.push(
          "The pages selected by pageRanges did not match the whole document they were checked on; some page numbers may be wrong.",
        );
      }
    }
  } else {
    pdf = await print(session, spec, timeoutMs);
  }

  log("printed", pdf.length, "bytes");

  if (config.metadata) {
    pdf = await injectPdfMetadata(pdf, {
      ...config.metadata,
      title: config.metadata.title || config.document_title || undefined,
      creator: config.metadata.creator || "mdforge",
    });
  }

  if (config.fillable) {
    pdf = await addAcroFormFields(Buffer.from(pdf), await readForms(session, prepared));
  }

  return pdf;
}

/** Browser-side: the options of every form select, by field name. */
function readSelectOptions(): Array<{ name: string; options: string[] }> {
  const result: Array<{ name: string; options: string[] }> = [];

  for (const select of document.querySelectorAll(
    "[data-form-field][data-field-type='select'] select",
  )) {
    if (!(select instanceof HTMLSelectElement)) continue;

    const name = select.closest("[data-form-field]")?.getAttribute("data-field-name");

    if (!name) continue;

    result.push({ name, options: Array.from(select.options).map((opt) => opt.value || opt.text) });
  }

  return result;
}

/** Browser-side: the font of the first form field, the fields' reference. */
function readFormFont(): { fontFamily: string; fontSize: number } | null {
  const input = document.querySelector(
    "[data-form-field] input, [data-form-field] select, [data-form-field] textarea",
  );

  if (!input) return null;

  const style = window.getComputedStyle(input);
  const fontFamily = style.fontFamily.split(",")[0]?.trim().replace(/['"]/g, "") || "Helvetica";

  return { fontFamily, fontSize: parseFloat(style.fontSize) || 12 };
}

/**
 * What the AcroForm fields are built from, read from the page as printed.
 * Scripts that change form fields around printing are not supported.
 */
async function readForms(session: Session, prepared: PreparedConversion) {
  const selects = await session.evaluate(readSelectOptions, undefined);
  const formFontInfo = (await session.evaluate(readFormFont, undefined)) ?? undefined;
  let embeddedFonts = prepared.embeddedFonts;

  // Without embedded web fonts, the system's file for the field font
  if ((!embeddedFonts || embeddedFonts.length === 0) && formFontInfo) {
    const systemFont = await detectSystemFont(formFontInfo.fontFamily);

    if (systemFont) embeddedFonts = [systemFont];
  }

  return {
    selectOptions:
      selects.length > 0 ? new Map(selects.map((s) => [s.name, s.options])) : undefined,
    formFontInfo,
    embeddedFonts,
  };
}

const run = promisify(execFile);

/**
 * The system's font file for a family, via fontconfig's fc-match. The family
 * comes from the document's CSS, so it is passed as an argument, never
 * through a shell.
 */
async function detectSystemFont(fontFamily: string): Promise<EmbeddedFontData | undefined> {
  try {
    const { stdout } = await run("fc-match", ["-f", "%{file}", fontFamily], {
      encoding: "utf-8",
      timeout: 5000,
    });

    const fontFile = stdout.trim();

    if (!/\.(ttf|otf|woff2?)$/i.test(fontFile)) return;

    return {
      family: fontFamily,
      data: new Uint8Array(await fs.readFile(fontFile)),
      weight: 400,
      style: "normal",
    };
  } catch {
    // fc-match not available, or no such font
    return;
  }
}

/**
 * Render a prepared conversion with a driver. Adds the load's warnings to
 * `prepared.info`, so call it once per prepared conversion.
 */
export async function render<Id>(
  driver: PageDriver<Id>,
  prepared: PreparedConversion,
): Promise<RenderResult> {
  log("rendering", prepared.format, "fillable:", prepared.config.fillable);

  // Applied to the page's own frames. A cross-origin iframe (an out-of-process
  // frame) prints with print media whatever page_media_type says - in both
  // renderers alike, as observed on Chrome 156/157.
  const environment: PageEnvironment = {
    viewport: VIEWPORT,
    mediaType: prepared.config.page_media_type,
  };

  const load = new RemoteLoad<Id>();
  const session = new Session(await driver.openPage(environment, load));

  try {
    await loadPage(session, prepared, load);
    log("loaded", load.timedOut ? "(cut short at the deadline)" : "");

    if (prepared.format === "html") {
      return { content: checkedHtml(await session.evaluate(snapshotHtml, undefined)) };
    }

    return { content: await pdfOutput(session, prepared) };
  } finally {
    await session.close();
    prepared.info.warnings.push(...load.warnings());
  }
}

/** The error a failed render is reported with, worded by what failed. */
function generationError(prepared: PreparedConversion, error: Error): GenerationError {
  const what = `Failed to create ${prepared.format.toUpperCase()}`;

  if (error instanceof RenderStepError) {
    const reason =
      error.step === "launch" ? "could not start the browser" : "could not open a browser page";

    return new GenerationError(`${what}: ${reason}: ${error.message}`, error);
  }

  return new GenerationError(`${what}: ${error.message}`, error);
}

/**
 * Convert markdown to PDF or HTML with a driver: prepare, render, write.
 *
 * @param driver - The renderer's browser control
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format and target, fillable override
 */
export async function convert<Id>(
  driver: PageDriver<Id>,
  input: MarkdownInput,
  config: Config,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const prepared = await prepareConversion(input, config, options);
  let output: RenderResult;

  try {
    output = await render(driver, prepared);
  } catch (thrown) {
    throw generationError(prepared, thrown instanceof Error ? thrown : new Error(String(thrown)));
  }

  await writeOutput(prepared.output, output.content);

  const filename = prepared.output.kind === "file" ? prepared.output.path : undefined;

  if (filename !== undefined) {
    prepared.info.output = { path: filename };
  }

  return { filename, content: output.content, info: prepared.info };
}
