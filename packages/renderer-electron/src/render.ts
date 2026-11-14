/**
 * Electron-based renderer for mdforge.
 *
 * Uses Electron's built-in Chromium via BrowserWindow and webContents.printToPDF().
 * This allows PDF generation without requiring a separate Puppeteer/Chrome installation.
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import process from "node:process";
import type { EmbeddedFontData } from "@mdforge/core/fonts";
import {
  buildPageHtml,
  pageCall,
  pageEndMarker,
  RemoteLoad,
  type ScratchPage,
  takeEndMarker,
  truncatedPageError,
  writeScratchPage,
} from "@mdforge/core/page-load";
import type { LoadedPage } from "@mdforge/core/page-refs";
import type { PreparedConversion } from "@mdforge/core/prepare";
import {
  PAGEREF_ATTR,
  readShownPageRefs,
  type ShownPageRef,
  writeShownPageRefs,
} from "@mdforge/core/xref";
import { addAcroFormFields, injectPdfMetadata } from "@mdforge/pdf";
import { BrowserWindow, session } from "electron";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[renderer-electron]", ...args);
  }
}

/**
 * Result of rendering a document.
 */
export interface RenderResult {
  /** The rendered content (PDF buffer or HTML string) */
  content: Buffer | Uint8Array | string;

  /** For fillable mode: extracted field info from DOM */
  fillableData?: {
    selectOptions: Map<string, string[]>;
    formFontInfo: { fontFamily: string; fontSize: number };
  };
}

/**
 * Detect the actual system font file using fc-match (Linux/macOS with fontconfig).
 */
async function detectSystemFont(fontFamily: string): Promise<EmbeddedFontData | undefined> {
  try {
    const fontFile = execSync(`fc-match -f '%{file}' "${fontFamily}"`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!fontFile?.match(/\.(ttf|otf|woff2?)$/i)) {
      return;
    }

    const fontData = await fs.readFile(fontFile);

    return {
      family: fontFamily,
      data: new Uint8Array(fontData),
      weight: 400,
      style: "normal",
    };
  } catch {
    return;
  }
}

/** The session every render window uses, kept apart from the app's own. */
const RENDER_PARTITION = "mdforge-render";

/** The remote loads of live render windows, by webContents id. */
const loads = new Map<number, RemoteLoad<number>>();

/**
 * Route the render session's requests to the load of the window that made
 * them. Electron keeps one listener per webRequest event per session, so this
 * one dispatcher serves every render window; it is installed once.
 */
let dispatching = false;

function dispatchRequests(): void {
  if (dispatching) return;
  dispatching = true;

  const { webRequest } = session.fromPartition(RENDER_PARTITION);

  webRequest.onBeforeRequest((details, callback) => {
    const load = details.webContentsId === undefined ? undefined : loads.get(details.webContentsId);
    callback({ cancel: load ? !load.admit(details.id, details.url) : false });
  });

  webRequest.onCompleted(settleRequest);
  webRequest.onErrorOccurred(settleRequest);
}

/** A render-session request finished or failed. */
function settleRequest(details: { id: number; webContentsId?: number }): void {
  if (details.webContentsId !== undefined) loads.get(details.webContentsId)?.settle(details.id);
}

/** Electron's named page sizes, keyed by lowercased Puppeteer paper format. */
const ELECTRON_PAGE_SIZES = new Map<
  string,
  Exclude<Electron.PrintToPDFOptions["pageSize"], Electron.Size | undefined>
>([
  ["a0", "A0"],
  ["a1", "A1"],
  ["a2", "A2"],
  ["a3", "A3"],
  ["a4", "A4"],
  ["a5", "A5"],
  ["a6", "A6"],
  ["letter", "Letter"],
  ["legal", "Legal"],
  ["tabloid", "Tabloid"],
  ["ledger", "Ledger"],
]);

/**
 * Map Puppeteer PDF options to Electron printToPDF options.
 */
function mapPdfOptions(pdfOptions: PreparedConversion["pdfOptions"]): Electron.PrintToPDFOptions {
  const options: Electron.PrintToPDFOptions = {
    printBackground: pdfOptions.printBackground ?? true,
    landscape: pdfOptions.landscape ?? false,
    // The outline gives the PDF its bookmarks (page references are resolved
    // from named destinations, not from it). Chromium builds it from the tagged structure: without
    // generateTaggedPDF (Electron's default is off, Puppeteer's on), Electron
    // 45 writes no outline at all, as observed on Chrome 156.
    generateDocumentOutline: true,
    generateTaggedPDF: true,
  };

  // Map page size
  if (pdfOptions.format) {
    const pageSize = ELECTRON_PAGE_SIZES.get(pdfOptions.format.toLowerCase());

    if (!pageSize) {
      throw new Error(`Invalid pageSize ${pdfOptions.format}`);
    }

    options.pageSize = pageSize;
  } else if (pdfOptions.width && pdfOptions.height) {
    // Custom size - Electron expects microns for custom sizes
    // Puppeteer uses CSS units, so we need to convert
    options.pageSize = {
      width: parseCssToMicrons(pdfOptions.width),
      height: parseCssToMicrons(pdfOptions.height),
    };
  }

  // Map margins
  if (pdfOptions.margin) {
    // Always an object: margin shorthand strings are expanded where the
    // YAML is parsed (core config-yaml.ts).
    const { margin } = pdfOptions;
    options.margins = {
      top: parseCssToInches(margin.top),
      bottom: parseCssToInches(margin.bottom),
      left: parseCssToInches(margin.left),
      right: parseCssToInches(margin.right),
    };
  }

  // Map scale
  if (pdfOptions.scale) {
    options.scale = pdfOptions.scale;
  }

  // Map header/footer
  if (pdfOptions.displayHeaderFooter) {
    options.displayHeaderFooter = true;

    if (pdfOptions.headerTemplate) {
      options.headerTemplate = pdfOptions.headerTemplate;
    }

    if (pdfOptions.footerTemplate) {
      options.footerTemplate = pdfOptions.footerTemplate;
    }
  }

  return options;
}

/**
 * Parse CSS length to microns (for Electron custom page size).
 */
function parseCssToMicrons(value: string | number | undefined): number {
  if (value === undefined) return 0;

  // A bare number has no unit suffix, so it falls through to inches below.
  const text = String(value);
  const num = parseFloat(text);

  if (text.endsWith("mm")) return num * 1000;

  if (text.endsWith("cm")) return num * 10000;

  if (text.endsWith("in")) return num * 25400;

  if (text.endsWith("px")) return num * (25400 / 96); // 96 DPI

  if (text.endsWith("pt")) return num * (25400 / 72); // 72 points per inch

  return num * 25400; // Default to inches
}

/**
 * Parse CSS length to inches (for Electron margins).
 */
function parseCssToInches(value: string | number | undefined): number {
  if (value === undefined) return 0;

  // A bare number has no unit suffix, so it falls through to inches below.
  const text = String(value);
  const num = parseFloat(text);

  if (text.endsWith("mm")) return num / 25.4;

  if (text.endsWith("cm")) return num / 2.54;

  if (text.endsWith("in")) return num;

  if (text.endsWith("px")) return num / 96;

  if (text.endsWith("pt")) return num / 72;

  return num; // Default to inches
}

/**
 * Load a prepared conversion into a hidden window, ready to print.
 *
 * The page is a file:// scratch copy of the document (see
 * `@mdforge/core/page-load`), so it loads the document's local files like the
 * Puppeteer renderer does and has no data: URL size cap. Every remote request
 * it makes, in any frame, is bounded by one deadline; once loading has ended,
 * new ones are refused.
 *
 * @param prepared - The prepared conversion from @mdforge/core
 * @returns The loaded page; the caller closes it
 */
export async function open(prepared: PreparedConversion): Promise<LoadedPage<RenderResult>> {
  log("Loading, format:", prepared.format, "fillable:", prepared.config.fillable);

  dispatchRequests();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition: RENDER_PARTITION,
    },
  });

  const { webContents } = win;
  const webContentsId = webContents.id;
  const load = new RemoteLoad<number>();
  loads.set(webContentsId, load);

  let scratch: ScratchPage | undefined;

  const close = (): void => {
    loads.delete(webContentsId);
    win.destroy();
  };

  try {
    const marker = pageEndMarker();
    scratch = await writeScratchPage(prepared.baseUrl, buildPageHtml(prepared, marker));
    const { url } = scratch;
    log("Loading", url);

    await load.run(
      [
        // Settles with the page's load event (did-finish-load)
        () => win.loadURL(url),
        async () => {
          await webContents.executeJavaScript("document.fonts.ready.then(() => undefined)");
        },
      ],
      () => {
        webContents.stop();

        return webContents.mainFrame.framesInSubtree.map(async (frame) => {
          await frame.executeJavaScript("window.stop()");
        });
      },
    );
    log("Page loaded", load.timedOut ? "(cut short at the deadline)" : "");

    const complete: unknown = await webContents.executeJavaScript(pageCall(takeEndMarker, marker));

    if (load.timedOut && complete !== true) {
      throw truncatedPageError(load);
    }

    // The page is loaded; the scratch HTML is no longer needed.
    await scratch.dispose();
    scratch = undefined;
  } catch (error) {
    // Cleanup failures must not replace the load's own error
    await scratch?.dispose().catch(() => undefined);
    close();
    throw error;
  }

  return {
    print: () => printPage(prepared, win),
    readPageRefs: async () => {
      const shown: ShownPageRef[] = await webContents.executeJavaScript(
        pageCall(readShownPageRefs, PAGEREF_ATTR),
      );

      return shown;
    },
    writePageRefs: async (texts) => {
      await webContents.executeJavaScript(
        pageCall(writeShownPageRefs, { attr: PAGEREF_ATTR, texts: [...texts] }),
      );
    },
    close: async () => {
      log("Destroying BrowserWindow");
      close();
      prepared.info.warnings.push(...load.warnings());
    },
  };
}

/** Print a loaded window to PDF or HTML. */
async function printPage(prepared: PreparedConversion, win: BrowserWindow): Promise<RenderResult> {
  const { config } = prepared;

  // Extract form field info if fillable mode is enabled
  let selectOptions: Map<string, string[]> | undefined;
  let formFontInfo: { fontFamily: string; fontSize: number } | undefined;
  let embeddedFonts = prepared.embeddedFonts;

  if (config.fillable && prepared.format === "pdf") {
    // Extract select options
    const selectData = await win.webContents.executeJavaScript(`
        (function() {
          const selects = document.querySelectorAll(
            "[data-form-field][data-field-type='select'] select"
          );
          const result = [];
          for (let i = 0; i < selects.length; i++) {
            const select = selects[i];
            if (!select) continue;
            const wrapper = select.closest("[data-form-field]");
            const name = wrapper?.getAttribute("data-field-name");
            if (!name) continue;
            const options = Array.from(select.options).map(
              (opt) => opt.value || opt.text
            );
            result.push({ name, options });
          }
          return result;
        })()
      `);

    if (selectData.length > 0) {
      selectOptions = new Map(
        selectData.map((s: { name: string; options: string[] }) => [s.name, s.options]),
      );
    }

    // Extract font info
    formFontInfo = await win.webContents.executeJavaScript(`
        (function() {
          const input = document.querySelector(
            "[data-form-field] input, [data-form-field] select, [data-form-field] textarea"
          );
          if (!input) return null;
          const style = window.getComputedStyle(input);
          const fontFamily =
            style.fontFamily.split(",")[0]?.trim().replace(/['"]/g, "") ||
            "Helvetica";
          const fontSize = parseFloat(style.fontSize) || 12;
          return { fontFamily, fontSize };
        })()
      `);

    // Try to detect system font if no embedded fonts
    if ((!embeddedFonts || embeddedFonts.length === 0) && formFontInfo) {
      const systemFontData = await detectSystemFont(formFontInfo.fontFamily);

      if (systemFontData) {
        embeddedFonts = [systemFontData];
      }
    }
  }

  if (prepared.format === "html") {
    log("Extracting HTML output...");

    const html: string = await win.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
    );

    log("HTML extracted, length:", html.length);

    return {
      content: html,
    };
  }

  // Generate PDF using Electron's printToPDF
  log("Generating PDF...");
  const pdfOptions = mapPdfOptions(prepared.pdfOptions);
  log("PDF options:", JSON.stringify(pdfOptions));

  let pdfContent: Buffer | Uint8Array = await win.webContents.printToPDF(pdfOptions);

  log("PDF generated, size:", pdfContent.length);

  // Post-process PDF
  log("Post-processing PDF...");

  // Inject PDF metadata if configured
  if (config.metadata) {
    log("Injecting metadata...");

    const metadata = {
      ...config.metadata,
      title: config.metadata.title || config.document_title || undefined,
      creator: config.metadata.creator || "mdforge",
    };

    if (metadata.title || metadata.author || metadata.subject || metadata.keywords?.length) {
      pdfContent = await injectPdfMetadata(Buffer.from(pdfContent), metadata);
    }
  }

  // Add AcroForm fields if fillable mode is enabled
  if (config.fillable) {
    log("Adding AcroForm fields...");
    pdfContent = await addAcroFormFields(Buffer.from(pdfContent), {
      selectOptions,
      formFontInfo,
      embeddedFonts,
    });
    log("AcroForm fields added");
  }

  log("Render complete, final size:", pdfContent.length);

  return {
    content: pdfContent,
    fillableData: selectOptions && formFontInfo ? { selectOptions, formFontInfo } : undefined,
  };
}
