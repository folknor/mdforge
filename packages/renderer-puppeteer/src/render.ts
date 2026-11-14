/**
 * Puppeteer-based renderer for mdforge.
 *
 * Takes a PreparedConversion from @mdforge/core and renders it to PDF or HTML.
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { EmbeddedFontData } from "@mdforge/core/fonts";
import { baseElement, type PreparedConversion } from "@mdforge/core/prepare";
import { addAcroFormFields, injectPdfMetadata } from "@mdforge/pdf";
import { type Browser, type Page, launch } from "puppeteer";

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
 * Store a single browser instance reference so that we can re-use it.
 */
let browserPromise: Promise<Browser> | undefined;

/**
 * Close the browser instance.
 */
export async function closeBrowser(): Promise<void> {
  // Forget the browser before waiting on it, so a launch that failed (say, a
  // wrong executablePath) does not stay cached and block the next launch.
  const pending = browserPromise;
  browserPromise = undefined;

  const browser = await pending?.catch(() => undefined);
  await browser?.close();
}

/**
 * Detect the actual system font file using fc-match (Linux/macOS with fontconfig).
 */
async function detectSystemFont(fontFamily: string): Promise<EmbeddedFontData | undefined> {
  try {
    // Use fc-match to find the font file
    const fontFile = execSync(`fc-match -f '%{file}' "${fontFamily}"`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!fontFile?.match(/\.(ttf|otf|woff2?)$/i)) {
      return;
    }

    // Read the font file
    const fontData = await fs.readFile(fontFile);

    return {
      family: fontFamily,
      data: new Uint8Array(fontData),
      weight: 400,
      style: "normal",
    };
  } catch {
    // fc-match not available or font not found
    return;
  }
}

/**
 * Render a prepared conversion to PDF or HTML.
 *
 * @param prepared - The prepared conversion from @mdforge/core
 * @param browserRef - Optional browser instance to reuse
 * @returns The rendered content
 */
export async function render(
  prepared: PreparedConversion,
  browserRef?: Browser,
): Promise<RenderResult> {
  const { config } = prepared;

  // Get or create browser
  async function getBrowser(): Promise<Browser> {
    if (browserRef) {
      return browserRef;
    }

    if (!browserPromise) {
      // A launch that fails, or a browser that later goes away, forgets itself
      // so the next render launches afresh: watch mode keeps rendering after a
      // failure. The identity check stops a stale one clearing a newer launch.
      const forget = (): void => {
        if (browserPromise === launching) browserPromise = undefined;
      };

      const launching: Promise<Browser> = (async () => {
        try {
          const browser = await launch(config.launch_options);
          browser.once("disconnected", forget);

          return browser;
        } catch (error) {
          forget();
          throw error;
        }
      })();

      browserPromise = launching;
    }

    return browserPromise;
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  // Scratch files and directories renderPage creates, removed with the page
  // whether or not the render succeeds
  const scratch: string[] = [];

  try {
    return await renderPage(prepared, page, scratch);
  } finally {
    // Cleanup failures must not replace the render's own error
    for (const path of scratch) {
      await fs.rm(path, { force: true, recursive: true }).catch(() => undefined);
    }

    await page.close().catch(() => undefined);
  }
}

/**
 * Write the page's HTML to a scratch file and return its path, recorded in
 * `scratch` for removal. The document's own directory is tried first; if it
 * is not writable, a fresh temporary directory. Either way the page gets a
 * file:// origin, and its `<base>` still points at the document.
 */
async function writeScratchHtml(
  prepared: PreparedConversion,
  html: string,
  scratch: string[],
): Promise<string> {
  const name = `.mdforge-${process.pid}-${Date.now()}.html`;
  const inDocumentDir = join(fileURLToPath(prepared.baseUrl), name);

  try {
    scratch.push(inDocumentDir);
    await fs.writeFile(inDocumentDir, html, "utf-8");

    return inDocumentDir;
  } catch {
    const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-"));
    scratch.push(dir);

    const inTempDir = join(dir, name);
    await fs.writeFile(inTempDir, html, "utf-8");

    return inTempDir;
  }
}

async function renderPage(
  prepared: PreparedConversion,
  page: Page,
  scratch: string[],
): Promise<RenderResult> {
  const { config } = prepared;

  // Inject <base> tag so relative paths in markdown resolve correctly
  const htmlWithBase = prepared.html.replace(
    "<head>",
    // A callback, so `$&` and friends in a directory name stay literal
    () => `<head>${baseElement(prepared.baseUrl)}`,
  );

  // Load the page from a real file:// URL rather than via setContent. A page
  // populated by setContent has an about:blank origin, and Chromium refuses to
  // load file:// subresources from it — so every relative <img>, every
  // stylesheet file, and any local font or asset, silently fails to render.
  const scratchHtmlPath = await writeScratchHtml(prepared, htmlWithBase, scratch);

  await page.goto(pathToFileURL(scratchHtmlPath).href, {
    waitUntil: "domcontentloaded",
  });

  // Add stylesheets in cascade order. Files are linked by their own URL, never
  // injected as text, so their relative url() and @import resolve against
  // their own directory rather than the document's.
  for (const stylesheet of prepared.stylesheets) {
    switch (stylesheet.type) {
      case "url":
        await page.addStyleTag({ url: stylesheet.value });
        break;
      case "content":
        await page.addStyleTag({ content: stylesheet.value });
        break;
      case "path":
        await page.addStyleTag({ url: pathToFileURL(stylesheet.value).href });
        break;
    }
  }

  // Add scripts
  for (const scriptTagOptions of prepared.scripts) {
    await page.addScriptTag(scriptTagOptions);
  }

  // Wait for network to be idle
  await page.waitForNetworkIdle();

  // The page is fully loaded; the scratch HTML is no longer needed.
  for (const path of scratch.splice(0)) {
    await fs.rm(path, { force: true, recursive: true });
  }

  // Extract form field info if fillable mode is enabled
  let selectOptions: Map<string, string[]> | undefined;
  let formFontInfo: { fontFamily: string; fontSize: number } | undefined;
  let embeddedFonts = prepared.embeddedFonts;

  if (config.fillable && prepared.format === "pdf") {
    // Extract select options (not encoded in marker URLs)
    const selectData = await page.evaluate(() => {
      const selects = document.querySelectorAll(
        "[data-form-field][data-field-type='select'] select",
      );

      const result: Array<{ name: string; options: string[] }> = [];

      for (let i = 0; i < selects.length; i++) {
        const select = selects[i];

        if (!(select instanceof HTMLSelectElement)) continue;
        const wrapper = select.closest("[data-form-field]");
        const name = wrapper?.getAttribute("data-field-name");

        if (!name) continue;

        const options = Array.from(select.options).map((opt) => opt.value || opt.text);

        result.push({ name, options });
      }

      return result;
    });

    if (selectData.length > 0) {
      selectOptions = new Map(selectData.map((s) => [s.name, s.options]));
    }

    // Extract font info from form fields (use first input/select as reference)
    formFontInfo = await page.evaluate(() => {
      const input = document.querySelector(
        "[data-form-field] input, [data-form-field] select, [data-form-field] textarea",
      );

      if (!input) return;
      const style = window.getComputedStyle(input);

      const fontFamily = style.fontFamily.split(",")[0]?.trim().replace(/['"]/g, "") || "Helvetica";

      const fontSize = parseFloat(style.fontSize) || 12;

      return { fontFamily, fontSize };
    });

    // If no embedded fonts from Google Fonts, try to detect system font file
    if ((!embeddedFonts || embeddedFonts.length === 0) && formFontInfo) {
      const systemFontData = await detectSystemFont(formFontInfo.fontFamily);

      if (systemFontData) {
        embeddedFonts = [systemFontData];
      }
    }
  }

  if (prepared.format === "html") {
    const html = await page.content();

    return {
      content: html,
    };
  }

  await page.emulateMediaType(config.page_media_type);

  const pdfOptions = {
    ...prepared.pdfOptions,
    outline: true,
  };

  // Post-process PDF
  let pdfContent: Buffer | Uint8Array = await page.pdf(pdfOptions);

  // Inject PDF metadata if configured
  if (config.metadata) {
    const metadata = {
      ...config.metadata,
      // Use document_title as fallback for metadata title
      title: config.metadata.title || config.document_title || undefined,
      // Set creator to mdforge if not specified
      creator: config.metadata.creator || "mdforge",
    };

    // Only inject if there's meaningful metadata
    if (metadata.title || metadata.author || metadata.subject || metadata.keywords?.length) {
      pdfContent = await injectPdfMetadata(Buffer.from(pdfContent), metadata);
    }
  }

  // Add AcroForm fields if fillable mode is enabled
  if (config.fillable) {
    pdfContent = await addAcroFormFields(Buffer.from(pdfContent), {
      selectOptions,
      formFontInfo,
      embeddedFonts,
    });
  }

  return {
    content: pdfContent,
    fillableData: selectOptions && formFontInfo ? { selectOptions, formFontInfo } : undefined,
  };
}
