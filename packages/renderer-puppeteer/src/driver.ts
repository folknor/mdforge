/**
 * The Puppeteer driver: browser control for @mdforge/render, and the browser
 * pools that own launched browsers.
 */

import type { LaunchSettings, PreparedConversion } from "@mdforge/core";
import type { ConvertOptions, MarkdownInput } from "@mdforge/core/prepare";
import {
  type CdpChannel,
  type CdpParams,
  type Config,
  FrameEnvironment,
  convert,
  type ConvertResult,
  type DriverPage,
  type PageDriver,
  type PageEnvironment,
  type PageValue,
  type PrintSpec,
  render,
  type RenderResult,
  RenderStepError,
  type RequestSink,
} from "@mdforge/render";
import {
  type Browser,
  type CDPSession,
  CDPSessionEvent,
  type HTTPRequest,
  launch,
  type Page,
} from "puppeteer";

const inches = (value: number): string => `${value}in`;

/** One Puppeteer page, held for the engine. */
class PuppeteerPage implements DriverPage {
  readonly failure: Promise<never>;
  readonly #page: Page;
  readonly #release: () => void;
  #closing = false;

  readonly #cdp: CDPSession;
  readonly #frames: FrameEnvironment;

  constructor(page: Page, browser: Browser, cdp: CDPSession, frames: FrameEnvironment) {
    this.#page = page;
    this.#cdp = cdp;
    this.#frames = frames;

    const { promise, reject: fail } = Promise.withResolvers<never>();
    this.failure = promise;
    // Handled from the start; the engine observes it through every call
    this.failure.catch(() => undefined);

    // FrameEnvironment rejects only with an Error
    frames.failure.catch((error: Error) => {
      if (!this.#closing) fail(error);
    });

    // The session holds the page environment; Chromium clears it when the
    // session ends, so losing it would silently print with the wrong media.
    const connection = cdp.connection();

    const sessionDetached = (session: CDPSession): void => {
      if (session === cdp && !this.#closing) {
        fail(new Error("The browser page lost its page settings (debugger session detached)"));
      }
    };

    connection?.on(CDPSessionEvent.SessionDetached, sessionDetached);

    const crashed = (error: Error): void =>
      fail(new Error(`The browser page crashed: ${error.message}`));

    const closed = (): void => {
      if (!this.#closing) fail(new Error("The browser page was closed during the conversion"));
    };

    const disconnected = (): void => {
      if (!this.#closing) fail(new Error("The browser went away during the conversion"));
    };

    page.on("error", crashed);
    page.once("close", closed);
    browser.once("disconnected", disconnected);

    this.#release = () => {
      page.off("error", crashed);
      page.off("close", closed);
      browser.off("disconnected", disconnected);
      connection?.off(CDPSessionEvent.SessionDetached, sessionDetached);
    };
  }

  async navigate(url: string): Promise<void> {
    // The engine's deadline bounds navigation, not Puppeteer's own timeout
    await this.#page.goto(url, { waitUntil: "load", timeout: 0 });
  }

  async evaluate(source: string): Promise<PageValue> {
    const value = await this.#page.evaluate(source);

    // SAFETY: Puppeteer returns an evaluated value by JSON-like
    // serialisation, so what arrives is data of PageValue's shape.
    return value as PageValue;
  }

  stopLoading(): ReadonlyArray<Promise<void>> {
    const page = this.#page;

    return [
      // Through the page's own session: attaching another one would reset
      // the page environment (frame-environment.ts in @mdforge/render).
      this.#cdp.send("Page.stopLoading").then(() => undefined),
      ...page.frames().map(async (frame) => {
        await frame.evaluate(() => window.stop());
      }),
    ];
  }

  async printPdf(spec: PrintSpec): Promise<Uint8Array> {
    await this.#frames.settled();

    return this.#page.pdf({
      width: inches(spec.paperWidth),
      height: inches(spec.paperHeight),
      margin: {
        top: inches(spec.margin.top),
        right: inches(spec.margin.right),
        bottom: inches(spec.margin.bottom),
        left: inches(spec.margin.left),
      },
      landscape: spec.landscape,
      scale: spec.scale,
      printBackground: spec.printBackground,
      displayHeaderFooter: spec.displayHeaderFooter,
      headerTemplate: spec.headerTemplate,
      footerTemplate: spec.footerTemplate,
      pageRanges: spec.pageRanges,
      preferCSSPageSize: spec.preferCSSPageSize,
      tagged: true,
      outline: true,
      // The engine waits for fonts and bounds the print itself
      waitForFonts: false,
      timeout: 0,
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#release();
    await this.#cdp.detach().catch(() => undefined);
    await this.#page.close().catch(() => undefined);
  }
}

/** A driver opening pages in whatever browser `browser` gives. */
function driverFor(browser: () => Promise<Browser>): PageDriver<HTTPRequest> {
  return {
    async openPage(
      environment: PageEnvironment,
      requests: RequestSink<HTTPRequest>,
    ): Promise<DriverPage> {
      let launched: Browser;

      try {
        launched = await browser();
      } catch (error) {
        throw new RenderStepError("launch", error);
      }

      let page: Page;

      try {
        page = await launched.newPage();
      } catch (error) {
        throw new RenderStepError("page", error);
      }

      let cdp: CDPSession;
      let frames: FrameEnvironment;

      try {
        // Puppeteer's own record of the environment agrees with what the
        // page session below sets, so neither undoes the other.
        await page.setViewport(environment.viewport);
        await page.emulateMediaType(environment.mediaType);

        cdp = await page.createCDPSession();
        frames = new FrameEnvironment(sessionChannel(cdp), environment);

        // Child sessions announce on the session that auto-attached them
        const watch = (session: CDPSession): void => {
          session.on(CDPSessionEvent.SessionAttached, (child) => {
            watch(child);
            frames.attached(child.id());
          });
        };

        watch(cdp);
        await frames.apply();

        // Every request, in every frame, passes admission; a refused one is
        // aborted.
        page.on("request", (request) => {
          const resolution = requests.admit(request, request.url())
            ? request.continue()
            : request.abort("blockedbyclient");

          // A request whose page or frame has gone cannot be resolved
          resolution.catch(() => undefined);
        });
        page.on("requestfinished", (request) => requests.settle(request));
        page.on("requestfailed", (request) => requests.settle(request));
        await page.setRequestInterception(true);
      } catch (error) {
        await page.close().catch(() => undefined);
        throw new RenderStepError("page", error);
      }

      return new PuppeteerPage(page, launched, cdp, frames);
    },
  };
}

/** A page's own session, and the child sessions attached through it, as a CdpChannel. */
function sessionChannel(root: CDPSession): CdpChannel {
  const connection = root.connection();

  const session = (sessionId: string | undefined): CDPSession | null =>
    sessionId === undefined ? root : (connection?.session(sessionId) ?? null);

  return {
    async send(method, params, sessionId) {
      const target = session(sessionId);

      if (!target) throw new Error("The frame's debugger session has gone");

      // SAFETY: CDPSession.send is typed per protocol method; the methods
      // FrameEnvironment sends are protocol commands taking these params.
      const send = target.send.bind(target) as (m: string, p: CdpParams) => Promise<void>;

      await send(method, params);
    },
    isAttached(sessionId) {
      const target = session(sessionId);

      return target !== null && !target.detached;
    },
  };
}

/**
 * Owns one browser, launched with fixed settings when first needed, shared
 * by every conversion made through it, until `close`. A launch that fails, or
 * a browser that goes away, is forgotten, so the next conversion launches
 * afresh.
 */
export class BrowserPool {
  readonly #settings: LaunchSettings;
  #launching: Promise<Browser> | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  /** @param settings - Copied: later changes to the object do not apply */
  constructor(settings: LaunchSettings = {}) {
    this.#settings = structuredClone(settings);
  }

  #browser(): Promise<Browser> {
    if (this.#closed) return Promise.reject(new Error("This browser pool has been closed"));

    if (!this.#launching) {
      // Clears only its own launch, never a newer one
      const forget = (): void => {
        if (this.#launching === launching) this.#launching = undefined;
      };

      const launching: Promise<Browser> = (async () => {
        const browser = await launch(this.#settings);

        if (this.#closed) {
          // Closed while launching: nobody will use or close it
          await browser.close().catch(() => undefined);
          throw new Error("This browser pool has been closed");
        }

        browser.once("disconnected", forget);

        return browser;
      })();

      launching.catch(forget);
      this.#launching = launching;
    }

    return this.#launching;
  }

  /** A driver for @mdforge/render using this pool's browser. */
  get driver(): PageDriver<HTTPRequest> {
    return driverFor(() => this.#browser());
  }

  /** Convert markdown with this pool's browser (see `convert`). */
  convertMdToPdf(
    input: MarkdownInput,
    config: Config,
    options?: ConvertOptions,
  ): Promise<ConvertResult> {
    return convert(this.driver, input, config, options);
  }

  /** Render a prepared conversion with this pool's browser. */
  render(prepared: PreparedConversion): Promise<RenderResult> {
    return render(this.driver, prepared);
  }

  /** Close the browser; the pool cannot be used afterwards. */
  close(): Promise<void> {
    this.#closed = true;

    this.#closing ??= (async () => {
      const browser = await this.#launching?.catch(() => undefined);
      this.#launching = undefined;
      await browser?.close().catch(() => undefined);
    })();

    return this.#closing;
  }
}

/** A driver for a browser the caller launched and closes itself. */
export function browserDriver(browser: Browser): PageDriver<HTTPRequest> {
  return driverFor(async () => browser);
}
