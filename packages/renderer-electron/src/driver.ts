/**
 * The Electron driver: browser control for @mdforge/render, using Electron's
 * own Chromium through hidden offscreen windows and webContents.printToPDF.
 * Needs a ready Electron app; it launches nothing.
 */

import type {
  DriverPage,
  PageDriver,
  PageEnvironment,
  PageValue,
  PrintSpec,
  RequestSink,
} from "@mdforge/render";
import { RenderStepError } from "@mdforge/render";
import { BrowserWindow, session } from "electron";

/** The session every render window uses, kept apart from the app's own. */
const RENDER_PARTITION = "mdforge-render";

/** Where the requests of live render windows go, by webContents id. */
const sinks = new Map<number, RequestSink<number>>();

/**
 * Route the render session's requests to the sink of the window that made
 * them. Electron keeps one listener per webRequest event per session, so this
 * one dispatcher serves every render window; it is installed once.
 *
 * It enforces the remote-content deadline only; local files are not limited
 * (documents are trusted, configuration reference "Trust"). Unlike Chrome,
 * Electron's file:// pages carry the grantFileProtocolExtraPrivileges fuse's
 * universal file access, so page scripts here can read local files by fetch,
 * XHR or a file iframe's DOM. Refusing file: requests of type "xhr" would not
 * restore Chrome's rules (the iframe read remains), so it is not done; real
 * parity needs the fuse flipped or a custom-protocol page origin.
 */
let dispatching = false;

function dispatchRequests(): void {
  if (dispatching) return;
  dispatching = true;

  const { webRequest } = session.fromPartition(RENDER_PARTITION);

  webRequest.onBeforeRequest((details, callback) => {
    const sink = details.webContentsId === undefined ? undefined : sinks.get(details.webContentsId);
    callback({ cancel: sink ? !sink.admit(details.id, details.url) : false });
  });

  webRequest.onCompleted(settleRequest);
  webRequest.onErrorOccurred(settleRequest);
}

/** A render-session request finished or failed. */
function settleRequest(details: { id: number; webContentsId?: number }): void {
  if (details.webContentsId !== undefined) sinks.get(details.webContentsId)?.settle(details.id);
}

/** One hidden render window, held for the engine. */
class WindowPage implements DriverPage {
  readonly failure: Promise<never>;
  readonly #win: BrowserWindow;
  #closing = false;

  constructor(win: BrowserWindow) {
    this.#win = win;
    const { webContents } = win;

    const { promise, reject: fail } = Promise.withResolvers<never>();
    this.failure = promise;
    // Handled from the start; the engine observes it through every call
    this.failure.catch(() => undefined);

    webContents.on("render-process-gone", (_event, details) => {
      if (!this.#closing) fail(new Error(`The render window's page crashed (${details.reason})`));
    });

    webContents.once("destroyed", () => {
      if (!this.#closing) fail(new Error("The render window was closed during the conversion"));
    });

    // The page environment is held by this debugger session; Chromium clears
    // it when the session ends, so losing it (say, to DevTools opening) would
    // silently print with the wrong media.
    webContents.debugger.on("detach", (_event, reason) => {
      if (!this.#closing) {
        fail(new Error(`The render window lost its page settings (debugger detached: ${reason})`));
      }
    });
  }

  async navigate(url: string): Promise<void> {
    // Settles with the page's load event (did-finish-load)
    await this.#win.loadURL(url);
  }

  async evaluate(source: string): Promise<PageValue> {
    const value: PageValue = await this.#win.webContents.executeJavaScript(source);

    return value;
  }

  stopLoading(): ReadonlyArray<Promise<void>> {
    const { webContents } = this.#win;
    webContents.stop();

    return webContents.mainFrame.framesInSubtree.map(async (frame) => {
      await frame.executeJavaScript("window.stop()");
    });
  }

  async printPdf(spec: PrintSpec): Promise<Uint8Array> {
    return this.#win.webContents.printToPDF({
      pageSize: { width: spec.paperWidth, height: spec.paperHeight },
      margins: spec.margin,
      landscape: spec.landscape,
      scale: spec.scale,
      printBackground: spec.printBackground,
      displayHeaderFooter: spec.displayHeaderFooter,
      headerTemplate: spec.headerTemplate,
      footerTemplate: spec.footerTemplate,
      pageRanges: spec.pageRanges,
      preferCSSPageSize: spec.preferCSSPageSize,
      // Chromium builds the outline from the tagged structure: without
      // tagging (Electron's default is off, Puppeteer's on) Electron writes
      // no outline at all.
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    });
  }

  async close(): Promise<void> {
    this.#closing = true;

    if (!this.#win.isDestroyed()) {
      sinks.delete(this.#win.webContents.id);
      this.#win.destroy();
    }
  }
}

/** The Electron driver. */
export const electronDriver: PageDriver<number> = {
  async openPage(environment: PageEnvironment, requests: RequestSink<number>): Promise<DriverPage> {
    let win: BrowserWindow;

    try {
      dispatchRequests();

      win = new BrowserWindow({
        width: environment.viewport.width,
        height: environment.viewport.height,
        useContentSize: true,
        show: false,
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
          partition: RENDER_PARTITION,
        },
      });
    } catch (error) {
      throw new RenderStepError("page", error);
    }

    const page = new WindowPage(win);
    const { webContents } = win;

    try {
      sinks.set(webContents.id, requests);

      // Set before the document loads, so the resources that load are the
      // ones the page environment uses. A window that has loaded nothing has
      // no page for the debugger to talk to (its commands never answer), so
      // it gets a blank one first; the session's overrides carry over every
      // later navigation.
      await win.loadURL("about:blank");
      webContents.debugger.attach("1.3");
      await webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width: environment.viewport.width,
        height: environment.viewport.height,
        deviceScaleFactor: environment.viewport.deviceScaleFactor,
        mobile: false,
      });
      await webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        media: environment.mediaType,
      });
    } catch (error) {
      await page.close();
      throw new RenderStepError("page", error);
    }

    return page;
  },
};
