/**
 * How a renderer loads the page it prints, shared by every renderer.
 *
 * The page is a file:// scratch copy of the prepared HTML in a private
 * temporary directory, so it may load the document's local files and has no size cap (a data: URL is capped at 2 MB by
 * Chromium, which embedded fonts alone can exceed).
 *
 * Remote content the browser fetches itself - URL stylesheets, remote images,
 * url() and @import in CSS, iframes - is bounded by one deadline per
 * conversion. Loading ends when the page has loaded and every remote request
 * it made has finished, or when the deadline passes, whichever comes first.
 * Either way admission then closes: from that moment every new remote request
 * is refused, and requests still outstanding are cancelled, so printing (and
 * every page-reference pass, which reuses the same page) never waits on the
 * network. Remote content that missed the deadline or was refused is named in
 * a warning; the document is printed without it.
 *
 * A stylesheet of the main document that fails to load for any other reason
 * (a missing file, an HTTP error, a refused connection, a failed `@import`)
 * is named in a warning too, if its failure was seen by the time loading
 * ended. Both can name the same stylesheet: each is true.
 *
 * What this does not promise: requests a worker makes are outside the
 * renderers' reach, and a cancellation the browser does not confirm within a
 * grace period is reported as such rather than assumed.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  baseElement,
  type PageScript,
  type PreparedConversion,
  stylesheetLink,
  styleTextEndsElement,
  styleTextError,
} from "./prepare.ts";

/** How long remote content the page loads may take, for the whole conversion. */
export const REMOTE_LOAD_DEADLINE_MS = 15_000;

/** How long cancelled requests get to report that they stopped. */
const CANCEL_GRACE_MS = 1_000;

function isRemote(url: string): boolean {
  return /^https?:/i.test(url);
}

/**
 * The page's HTML: the prepared document with its `<base>`, the stylesheet
 * load watch ({@link watchStylesheetLoads}), then the stylesheets in cascade
 * order (CSS text as `<style>`, files and URLs as `<link>`, so a file's
 * relative references resolve against its own directory), and `marker` as a
 * comment closing the body. `marker` also names the watch.
 *
 * Expects `prepared.html` to be the wrapper `getHtml()` builds, whose literal
 * `<head>` is where all of this goes. The `<base>` is what makes the page's
 * relative URLs resolve against the document; the scratch file's own location
 * ({@link writeScratchPage}) does not.
 *
 * Throws for CSS text that would end its `<style>` element early
 * ({@link styleTextEndsElement}).
 */
export function buildPageHtml(prepared: PreparedConversion, marker: string): string {
  const styles = prepared.stylesheets.map((stylesheet) => {
    switch (stylesheet.type) {
      case "content":
        if (styleTextEndsElement(stylesheet.value)) throw styleTextError(stylesheet.value);

        return `<style>${stylesheet.value}</style>`;
      case "path":
        return stylesheetLink(pathToFileURL(stylesheet.value).href);
      case "url":
        return stylesheetLink(stylesheet.value);
    }
  });

  // Before every stylesheet, so it sees each one's load fail
  const watch = `<script>${pageCall(watchStylesheetLoads, marker)}</script>`;

  // Callbacks, so `$&` and friends in a directory name or stylesheet stay
  // literal
  const withHead = prepared.html.replace(
    "<head>",
    () => `<head>${baseElement(prepared.baseUrl)}\n${watch}\n${styles.join("\n")}`,
  );

  const end = withHead.lastIndexOf("</body>");
  const comment = `<!--${marker}-->`;

  return end === -1
    ? `${withHead}${comment}`
    : `${withHead.slice(0, end)}${comment}${withHead.slice(end)}`;
}

/** A unique marker for {@link buildPageHtml}. */
export function pageEndMarker(): string {
  return `mdforge-end-${randomUUID()}`;
}

/** A scratch page on disk, removed by `dispose`. */
export interface ScratchPage {
  /** The page's file:// URL */
  url: string;
  dispose(): Promise<void>;
}

/**
 * Write the page's HTML to a scratch file in a fresh private (0700) temporary
 * directory, which `dispose` removes. The file exists only so the page has a
 * file:// origin: its location means nothing, because the page's `<base>`
 * resolves every relative URL against the document's directory. It is never
 * written beside the document, so a render leaves nothing in the user's
 * directories (nothing for watchers, sync tools or `git status` to see, and
 * nothing left there if the process dies mid-load), and a content input's
 * `baseDir` is only read from, never written to.
 *
 * The browser must see the temporary directory at the same path as this
 * process; a separately confined browser (Snap Chromium's private /tmp) needs
 * `TMPDIR` pointed somewhere both share.
 */
export async function writeScratchPage(html: string): Promise<ScratchPage> {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-"));
  const remove = () => fs.rm(dir, { force: true, recursive: true });

  try {
    const file = join(dir, "page.html");
    await fs.writeFile(file, html, { encoding: "utf-8", flag: "wx" });

    return { url: pathToFileURL(file).href, dispose: remove };
  } catch (error) {
    await remove().catch(() => undefined);
    throw error;
  }
}

/** One step of loading the page, settling when the step is done. */
export type LoadStage = () => Promise<void>;

/** Stop every frame's loading; one promise per stop issued. */
export type StopLoading = () => ReadonlyArray<Promise<void>>;

function listed(urls: ReadonlySet<string>): string {
  return [...urls].join(", ");
}

/**
 * The remote requests of one page: which are outstanding, and which were left
 * out. Renderers report every request the browser starts (`admit`) and every
 * one that ends (`settle`) - ends meaning finished or failed, not merely
 * answered with headers.
 *
 * `Id` identifies one request: whatever the renderer's request events carry
 * (Puppeteer's request object, Electron's numeric id).
 */
export class RemoteLoad<Id> {
  #admitting = true;
  readonly #outstanding = new Map<Id, string>();
  readonly #drainWaiters: Array<() => void> = [];
  readonly #deadlineMs: number;

  /** Outstanding when admission closed, then cancelled */
  readonly #cancelled = new Set<string>();
  /** Refused after admission closed */
  readonly #refused = new Set<string>();
  /** Still outstanding after the cancellation grace period */
  readonly #unconfirmed = new Set<string>();
  #timedOut = false;
  /** Outstanding when admission closed */
  #cut: readonly string[] = [];

  constructor(deadlineMs: number = REMOTE_LOAD_DEADLINE_MS) {
    this.#deadlineMs = deadlineMs;
  }

  /** The deadline, in milliseconds. */
  get deadlineMs(): number {
    return this.#deadlineMs;
  }

  /** The remote URLs still outstanding when admission closed. */
  get cutAtClose(): readonly string[] {
    return this.#cut;
  }

  /** Whether loading was cut short by the deadline. */
  get timedOut(): boolean {
    return this.#timedOut;
  }

  /**
   * A request is starting. Returns whether it may proceed: local requests
   * always may, remote ones only until admission closes.
   *
   * This is a deadline, not an access-control boundary. Unrestricted local
   * references are supported: an allowlist here would protect nothing,
   * because preparation (includes, `@file`, stylesheet and script paths)
   * already puts any readable file into the page, and documents are trusted
   * (configuration reference, "Trust").
   */
  admit(id: Id, url: string): boolean {
    if (!isRemote(url)) return true;

    if (!this.#admitting) {
      this.#refused.add(url);

      return false;
    }

    this.#outstanding.set(id, url);

    return true;
  }

  /** A request finished or failed. Unknown ids are ignored. */
  settle(id: Id): void {
    if (this.#outstanding.delete(id) && this.#outstanding.size === 0) {
      for (const resolve of this.#drainWaiters.splice(0)) resolve();
    }
  }

  /** Resolves once no remote request is outstanding. */
  drained(): Promise<void> {
    if (this.#outstanding.size === 0) return Promise.resolve();

    return new Promise((resolve) => this.#drainWaiters.push(resolve));
  }

  /** The URLs outstanding right now. */
  pending(): string[] {
    return [...new Set(this.#outstanding.values())];
  }

  /**
   * Run a page's load: each stage in turn, then wait for remote requests to
   * drain, all under the deadline. Then close admission and cancel whatever
   * is still outstanding with `stopLoading`, waiting at most a short grace
   * period for the cancellations to land.
   *
   * A stage that fails before the deadline fails the load. A stage still
   * running at the deadline is abandoned (its eventual failure, expected once
   * loading is stopped, is swallowed) and no later stage starts.
   */
  async run(
    stages: readonly LoadStage[],
    stopLoading: StopLoading,
    graceMs: number = CANCEL_GRACE_MS,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const expired = new Promise<"expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), this.#deadlineMs);
    });

    const within = async (work: Promise<void>): Promise<boolean> => {
      work.catch(() => undefined);

      return (await Promise.race([work.then(() => "done" as const), expired])) === "done";
    };

    try {
      let finished = true;

      for (const stage of stages) {
        if (!(await within(stage()))) {
          finished = false;
          break;
        }
      }

      if (finished) finished = await within(this.drained());

      this.#timedOut = !finished;
    } finally {
      clearTimeout(timer);
      this.#admitting = false;
    }

    await this.#cancelOutstanding(stopLoading, graceMs);
  }

  async #cancelOutstanding(stopLoading: StopLoading, graceMs: number): Promise<void> {
    const cut = this.pending();
    this.#cut = cut;

    if (cut.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    // The grace period starts before any stop is issued, so a stop that never
    // settles cannot hold it open.
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });

    try {
      let stops: ReadonlyArray<Promise<void>>;

      try {
        stops = stopLoading();
      } catch {
        stops = [];
      }

      const stopped = Promise.allSettled(stops).then(() => this.drained());
      await Promise.race([stopped, grace]);
    } finally {
      clearTimeout(timer);
    }

    const still = new Set(this.pending());

    for (const url of cut) {
      (still.has(url) ? this.#unconfirmed : this.#cancelled).add(url);
    }
  }

  /** The warnings for what the page was printed without, if anything. */
  warnings(): string[] {
    const seconds = this.#deadlineMs / 1000;
    const result: string[] = [];

    if (this.#cancelled.size > 0) {
      result.push(
        `Remote content did not finish loading within ${seconds} seconds and was left out: ${listed(this.#cancelled)}.`,
      );
    }

    if (this.#unconfirmed.size > 0) {
      result.push(
        `Remote content was still loading when the document was printed, so it may be missing: ${listed(this.#unconfirmed)}.`,
      );
    }

    if (this.#refused.size > 0) {
      result.push(
        `Remote content requested after the page had finished loading was left out: ${listed(this.#refused)}.`,
      );
    }

    return result;
  }
}

/** What {@link watchStylesheetLoads} keeps in the page. */
interface StylesheetWatch {
  /** Each failed stylesheet, described when its error fired */
  failed: string[];
  /** Whether the watch's listeners are still attached; detaches them */
  finish(): boolean;
}

declare global {
  interface Window {
    /** The page's stylesheet watches, by the page's end marker */
    mdforgeStylesheetWatches?: Map<string, StylesheetWatch>;
  }
}

/**
 * Browser-side, run as the first script in the page's head: record every
 * stylesheet of the main document whose load fails - a `<link>` whose file
 * or URL cannot be loaded (missing file, HTTP error, refused connection), or
 * a `<link>` or `<style>` with an `@import` that cannot. Chromium fires
 * `error` on the importing element in both cases, and does not bubble it, so
 * the listener captures on the document. Only browser-dispatched events
 * count. The script removes itself as it runs, so no document script, and no
 * HTML output, sees it. Self-contained, for {@link pageCall}.
 *
 * Not seen: stylesheets in child frames or shadow roots.
 */
export function watchStylesheetLoads(key: string): void {
  const failed: string[] = [];
  let alive = false;

  const onError = (event: Event): void => {
    if (!event.isTrusted) return;

    const { target } = event;

    if (target instanceof HTMLLinkElement && target.relList.contains("stylesheet")) {
      failed.push(target.href);
    } else if (target instanceof HTMLStyleElement) {
      const position = Array.from(document.querySelectorAll("style")).indexOf(target) + 1;
      failed.push(target.id ? `<style id="${target.id}">` : `<style> element number ${position}`);
    }
  };

  // document.open() removes every listener; this one shows whether it did
  const onProbe = (): void => {
    alive = true;
  };

  document.addEventListener("error", onError, true);
  document.addEventListener(key, onProbe);

  const watch: StylesheetWatch = {
    failed,
    finish: () => {
      document.dispatchEvent(new Event(key));
      document.removeEventListener("error", onError, true);
      document.removeEventListener(key, onProbe);

      return alive;
    },
  };

  window.mdforgeStylesheetWatches ??= new Map();
  window.mdforgeStylesheetWatches.set(key, watch);
  document.currentScript?.remove();
}

/** What the page reported when loading ended. */
export interface PageLoadEnd {
  /** Whether the end marker was there: the HTML was parsed to the end */
  complete: boolean;
  /** Failed stylesheets, as {@link watchStylesheetLoads} described them */
  failedStylesheets: string[];
  /** Whether the watch saw the whole load (it can be lost to document.open()) */
  watched: boolean;
}

/**
 * Browser-side, once loading has ended: find the end marker comment and
 * remove it, and stop the stylesheet watch and read it, in one evaluation so
 * both describe the same moment. Self-contained, for {@link pageCall}.
 */
export function endPageLoad(marker: string): PageLoadEnd {
  let complete = false;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue === marker) {
      node.parentNode?.removeChild(node);
      complete = true;
      break;
    }
  }

  const watch = window.mdforgeStylesheetWatches?.get(marker);
  window.mdforgeStylesheetWatches?.delete(marker);

  if (watch === undefined) return { complete, failedStylesheets: [], watched: false };

  const watched = watch.finish();

  return { complete, failedStylesheets: [...watch.failed], watched };
}

/** The warnings for what {@link endPageLoad} reported about stylesheets. */
export function stylesheetLoadWarnings(end: PageLoadEnd): string[] {
  const result: string[] = [];

  if (end.failedStylesheets.length > 0) {
    result.push(
      `A stylesheet, or a stylesheet it imports, could not be loaded, so some of its styles may be missing: ${[...new Set(end.failedStylesheets)].join(", ")}.`,
    );
  }

  if (!end.watched) {
    result.push(
      "Whether every stylesheet loaded could not be checked (the page has no <head>, or replaced its document while loading).",
    );
  }

  return result;
}

/**
 * Browser-side: add one configured script to the page's head as a real
 * `<script>` element, so it runs as document code in the page's own world.
 * Self-contained, for evaluation in the page via {@link pageCall}.
 *
 * What is waited on: a `src` script until it has loaded (for a classic script,
 * run) and fails if it cannot load; inline code is added and, if classic, runs
 * during the insertion. Inline module scripts, top-level await and anything a
 * script starts asynchronously are not waited on. An exception the code throws
 * is the page's own error and does not fail the conversion.
 */
export function addPageScript(script: PageScript): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");

    if (script.type !== undefined) element.type = script.type;

    if (script.id !== undefined) element.id = script.id;

    if (script.src === undefined) {
      element.text = script.content ?? "";
      document.head.appendChild(element);
      resolve();

      return;
    }

    const { src } = script;
    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error(`Could not load script ${src}`)), {
      once: true,
    });
    element.src = src;
    document.head.appendChild(element);
  });
}

/**
 * The error for a page whose loading was stopped at the deadline before its
 * HTML had been parsed to the end: printing it would silently drop the rest of
 * the document.
 */
export function truncatedPageError<Id>(load: RemoteLoad<Id>): Error {
  const cut = load.cutAtClose;
  const waiting = cut.length > 0 ? ` (waiting on ${cut.join(", ")})` : "";

  return new Error(
    `The page had not finished loading after ${load.deadlineMs / 1000} seconds${waiting}, and stopping it cut the document short.`,
  );
}

/**
 * Source for calling a self-contained browser-side function in the page with
 * one JSON argument.
 */
export function pageCall<A, R>(fn: (arg: A) => R, arg: A): string {
  return `(${fn.toString()})(${JSON.stringify(arg)})`;
}
