/**
 * The browser-control layer: everything a renderer has to supply, and nothing
 * more. What is loaded, injected, waited for and printed, and when, is the
 * engine's (engine.ts); a driver only carries it out with its own browser.
 */

import type { PrintSpec } from "./print-spec.ts";

/** What the document sees of its window, set before it loads. */
export interface PageEnvironment {
  viewport: { width: number; height: number; deviceScaleFactor: number };
  mediaType: "screen" | "print";
}

/**
 * Where a driver reports the page's requests: every request the browser
 * starts, in any frame (`admit`, which says whether it may proceed), and
 * every one that finished or failed (`settle`). `Id` is whatever identifies
 * one request to the driver. RemoteLoad from `@mdforge/core/page-load`.
 */
export interface RequestSink<Id> {
  admit(id: Id, url: string): boolean;
  settle(id: Id): void;
}

/** What evaluating in the page gives back: data both browsers transfer as JSON does. */
export type PageValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | PageValue[]
  | { [key: string]: PageValue };

/** The driver operation that failed, for the engine to word the error. */
export type RenderStep = "launch" | "page";

/**
 * A driver failure the engine reports by step rather than by message: the
 * browser could not be started, or no page could be opened in it.
 */
export class RenderStepError extends Error {
  readonly step: RenderStep;

  constructor(step: RenderStep, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RenderStepError";
    this.step = step;
  }
}

export interface PageDriver<Id> {
  /**
   * A blank page, with `environment` applied and every request it will make
   * routed to `requests`, before anything is loaded. Throws RenderStepError.
   */
  openPage(environment: PageEnvironment, requests: RequestSink<Id>): Promise<DriverPage>;
}

export interface DriverPage {
  /**
   * Rejects when the page is lost other than by `close` - its renderer
   * crashed, its browser went away, or (Electron) the debugger session that
   * holds its environment was detached. Never resolves.
   */
  readonly failure: Promise<never>;
  /** Load `url`; settles at the load event, with no timeout of its own. */
  navigate(url: string): Promise<void>;
  /** Evaluate a JavaScript expression in the page's main world; awaits a promise result. */
  evaluate(source: string): Promise<PageValue>;
  /** Stop every frame's loading; one promise per stop issued. */
  stopLoading(): ReadonlyArray<Promise<void>>;
  /** Print the page with `spec`, tagged and with an outline, with no timeout of its own. */
  printPdf(spec: PrintSpec): Promise<Uint8Array>;
  /** Release the page. Never makes `failure` reject. */
  close(): Promise<void>;
}
