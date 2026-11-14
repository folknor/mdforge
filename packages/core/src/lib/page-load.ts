/**
 * How a renderer loads the page it prints, shared by every renderer.
 *
 * The page is a file:// scratch copy of the prepared HTML, so it may load the
 * document's local files and has no size cap (a data: URL is capped at 2 MB by
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
 * What this does not promise: requests a worker makes are outside the
 * renderers' reach, and a cancellation the browser does not confirm within a
 * grace period is reported as such rather than assumed.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baseElement, type PreparedConversion, stylesheetLink } from "./prepare.ts";

/** How long remote content the page loads may take, for the whole conversion. */
export const REMOTE_LOAD_DEADLINE_MS = 15_000;

/** How long cancelled requests get to report that they stopped. */
const CANCEL_GRACE_MS = 1_000;

function isRemote(url: string): boolean {
  return /^https?:/i.test(url);
}

/**
 * The page's HTML: the prepared document with its `<base>`, then the
 * stylesheets in cascade order (CSS text as `<style>`, files and URLs as
 * `<link>`, so a file's relative references resolve against its own
 * directory), and `marker` as a comment closing the body.
 */
export function buildPageHtml(prepared: PreparedConversion, marker: string): string {
  const styles = prepared.stylesheets.map((stylesheet) => {
    switch (stylesheet.type) {
      case "content":
        return `<style>${stylesheet.value}</style>`;
      case "path":
        return stylesheetLink(pathToFileURL(stylesheet.value).href);
      case "url":
        return stylesheetLink(stylesheet.value);
    }
  });

  // Callbacks, so `$&` and friends in a directory name or stylesheet stay
  // literal
  const withHead = prepared.html.replace(
    "<head>",
    () => `<head>${baseElement(prepared.baseUrl)}\n${styles.join("\n")}`,
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
 * Write the page's HTML to a scratch file under a fresh unique name. The
 * document's own directory is tried first; if it is not writable, a fresh
 * temporary directory. Either way the page has a file:// origin, and its
 * `<base>` still points at the document.
 */
export async function writeScratchPage(baseUrl: string, html: string): Promise<ScratchPage> {
  const name = `.mdforge-${randomUUID()}.html`;
  const inDocumentDir = join(fileURLToPath(baseUrl), name);

  try {
    // wx: never overwrite anything, even a file that appeared meanwhile
    await fs.writeFile(inDocumentDir, html, { encoding: "utf-8", flag: "wx" });

    return {
      url: pathToFileURL(inDocumentDir).href,
      dispose: () => fs.rm(inDocumentDir, { force: true }),
    };
  } catch {
    const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-"));
    const remove = () => fs.rm(dir, { force: true, recursive: true });

    try {
      const inTempDir = join(dir, name);
      await fs.writeFile(inTempDir, html, { encoding: "utf-8", flag: "wx" });

      return { url: pathToFileURL(inTempDir).href, dispose: remove };
    } catch (error) {
      await remove().catch(() => undefined);
      throw error;
    }
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

/**
 * Browser-side: find the end marker comment, remove it, and report whether it
 * was there. Self-contained, for evaluation in the page via {@link pageCall}.
 */
export function takeEndMarker(marker: string): boolean {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue === marker) {
      node.parentNode?.removeChild(node);

      return true;
    }
  }

  return false;
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
