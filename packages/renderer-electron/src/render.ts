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
import type { PreparedConversion } from "@mdforge/core/prepare";
import { addAcroFormFields, injectPdfMetadata } from "@mdforge/pdf";
import { BrowserWindow } from "electron";

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
async function detectSystemFont(
  fontFamily: string,
): Promise<EmbeddedFontData | undefined> {
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

/**
 * Build complete HTML with stylesheets inlined.
 * Electron doesn't have addStyleTag like Puppeteer, so we inline everything.
 */
async function buildCompleteHtml(
  prepared: PreparedConversion,
): Promise<string> {
  const styleParts: string[] = [];

  for (const stylesheet of prepared.stylesheets) {
    if (stylesheet.type === "content") {
      styleParts.push(`<style>${stylesheet.value}</style>`);
    } else if (stylesheet.type === "path") {
      // Read file and inline it
      try {
        const css = await fs.readFile(stylesheet.value, "utf-8");
        styleParts.push(`<style>${css}</style>`);
      } catch {
        // Skip missing stylesheets
      }
    } else if (stylesheet.type === "url") {
      styleParts.push(`<link rel="stylesheet" href="${stylesheet.value}">`);
    }
  }

  // Inject stylesheets and base URL into head
  const stylesHtml = styleParts.join("\n");

  return prepared.html.replace(
    "<head>",
    `<head><base href="${prepared.baseUrl}">\n${stylesHtml}`,
  );
}

/**
 * Map Puppeteer PDF options to Electron printToPDF options.
 */
function mapPdfOptions(
  pdfOptions: PreparedConversion["pdfOptions"],
): Electron.PrintToPDFOptions {
  const options: Electron.PrintToPDFOptions = {
    printBackground: pdfOptions.printBackground ?? true,
    landscape: pdfOptions.landscape ?? false,
    generateDocumentOutline: true,
  };

  // Map page size
  if (pdfOptions.format) {
    options.pageSize =
      pdfOptions.format.toUpperCase() as Electron.PrintToPDFOptions["pageSize"];
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
    const margin = pdfOptions.margin;
    options.margins = {
      top: parseCssToInches(typeof margin === "object" ? margin.top : margin),
      bottom: parseCssToInches(
        typeof margin === "object" ? margin.bottom : margin,
      ),
      left: parseCssToInches(typeof margin === "object" ? margin.left : margin),
      right: parseCssToInches(
        typeof margin === "object" ? margin.right : margin,
      ),
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

  if (typeof value === "number") return value * 25400; // Assume inches

  const num = parseFloat(value);

  if (value.endsWith("mm")) return num * 1000;

  if (value.endsWith("cm")) return num * 10000;

  if (value.endsWith("in")) return num * 25400;

  if (value.endsWith("px")) return num * (25400 / 96); // 96 DPI

  if (value.endsWith("pt")) return num * (25400 / 72); // 72 points per inch

  return num * 25400; // Default to inches
}

/**
 * Parse CSS length to inches (for Electron margins).
 */
function parseCssToInches(value: string | number | undefined): number {
  if (value === undefined) return 0;

  if (typeof value === "number") return value;

  const num = parseFloat(value);

  if (value.endsWith("mm")) return num / 25.4;

  if (value.endsWith("cm")) return num / 2.54;

  if (value.endsWith("in")) return num;

  if (value.endsWith("px")) return num / 96;

  if (value.endsWith("pt")) return num / 72;

  return num; // Default to inches
}

/**
 * Render a prepared conversion to PDF or HTML using Electron.
 *
 * @param prepared - The prepared conversion from @mdforge/core
 * @returns The rendered content
 */
export async function render(
  prepared: PreparedConversion,
): Promise<RenderResult> {
  const { config } = prepared;

  log(
    "Starting render, as_html:",
    config.as_html,
    "fillable:",
    config.fillable,
  );

  // Create a hidden BrowserWindow for rendering
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  log("BrowserWindow created");

  try {
    // Build complete HTML with inlined stylesheets
    log("Building complete HTML...");
    const completeHtml = await buildCompleteHtml(prepared);
    log("HTML built, length:", completeHtml.length);

    // Load the HTML content
    // Use data URI to avoid file system dependencies
    const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(completeHtml)}`;
    log("Loading data URI (length:", dataUri.length, ")...");

    // loadURL returns when load completes - no need for did-finish-load listener
    await win.loadURL(dataUri);
    log("Page loaded");

    // Additional wait for any async resources (fonts, images)
    await new Promise((resolve) => setTimeout(resolve, 100));
    log("Waited for async resources");

    // Extract form field info if fillable mode is enabled
    let selectOptions: Map<string, string[]> | undefined;
    let formFontInfo: { fontFamily: string; fontSize: number } | undefined;
    let embeddedFonts = prepared.embeddedFonts;

    if (config.fillable && !config.as_html) {
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
          selectData.map((s: { name: string; options: string[] }) => [
            s.name,
            s.options,
          ]),
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

    let outputFileContent: string | Buffer | Uint8Array;

    if (config.as_html) {
      log("Extracting HTML output...");
      outputFileContent = await win.webContents.executeJavaScript(
        "document.documentElement.outerHTML",
      );
      log("HTML extracted, length:", (outputFileContent as string).length);
    } else {
      // Generate PDF using Electron's printToPDF
      log("Generating PDF...");
      const pdfOptions = mapPdfOptions(prepared.pdfOptions);
      log("PDF options:", JSON.stringify(pdfOptions));
      outputFileContent = await win.webContents.printToPDF(pdfOptions);
      log("PDF generated, size:", (outputFileContent as Buffer).length);
    }

    if (config.as_html) {
      return {
        content: outputFileContent as string,
      };
    }

    // Post-process PDF
    log("Post-processing PDF...");
    let pdfContent = outputFileContent as Buffer | Uint8Array;

    // Inject PDF metadata if configured
    if (config.metadata) {
      log("Injecting metadata...");

      const metadata = {
        ...config.metadata,
        title: config.metadata.title || config.document_title || undefined,
        creator: config.metadata.creator || "mdforge",
      };

      if (
        metadata.title ||
        metadata.author ||
        metadata.subject ||
        metadata.keywords?.length
      ) {
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
      fillableData:
        selectOptions && formFontInfo
          ? { selectOptions, formFontInfo }
          : undefined,
    };
  } finally {
    // Always close the window
    log("Destroying BrowserWindow");
    win.destroy();
  }
}
