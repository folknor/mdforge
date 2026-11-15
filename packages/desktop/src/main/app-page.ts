import { isAbsolute, relative, resolve, sep } from "node:path";
import type { IpcMainInvokeEvent, WebContents } from "electron";

/** The scheme the packaged app page is served on (app-protocol.ts). */
export const appScheme = "app";

const appHost = "mdforge";

/** The packaged app page's URL. */
export const appPageUrl = `${appScheme}://${appHost}/index.html`;

/**
 * The file under `root` an app-scheme URL names, or undefined if it names
 * none. What this serves is what IPC trusts, since trust follows the app
 * page's URL. Containment is lexical: the root is Vite's build output, which
 * holds no symlinks.
 */
export function appFile(root: string, url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;

  const parsed = new URL(url);

  if (parsed.protocol !== `${appScheme}:` || parsed.host !== appHost) return undefined;

  let path: string;

  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }

  const file = resolve(root, `.${sep}${path}`);
  const inside = relative(root, file);

  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return undefined;
  }

  return file;
}

/**
 * Which windows hold the app's own page, and so may use the app's IPC.
 *
 * Only the main window has the preload, and only its top frame runs it, so
 * IPC can only come from there. What that frame holds is the question: the
 * navigation guard keeps it on the app's page, and this records whether the
 * document it last committed is that page, so IPC answers only while it is.
 *
 * Trust follows full-document commits, never the frame's current URL: the
 * History API can rewrite that URL without loading anything, so a page that
 * replaced the app and then pushState'd the app's URL back would match it. An
 * unexpected commit, a failed main-frame load (Chromium commits its error
 * page without a did-navigate) or a renderer crash revokes trust, and only a
 * fresh commit of the app's page restores it.
 *
 * Paths and output directories the renderer sends are deliberately not
 * checked against what a dialog returned. Dropped files reach the page
 * through the preload's webUtils.getPathForFile, not through main, and the
 * only possible sender is the app page itself, which can drive its own UI
 * anyway. Nor would a path allowlist bound what conversion reads: documents
 * are trusted input and their includes and scripts reach any file mdforge can
 * read (docs/docs/reference/configuration.md, "Trust"). Arguments are typed by
 * the shared ElectronAPI and, coming from the verified app bundle, are trusted
 * like any programmatic Config.
 */
export class AppPage {
  readonly url: string;
  #trusted = false;

  constructor(url: string) {
    this.url = url;
  }

  /** Whether a top-frame navigation or redirect to `target` may proceed. */
  allows(target: string): boolean {
    return sameDocument(target, this.url);
  }

  /** A full main-frame document commit. */
  committed(url: string): void {
    this.#trusted = sameDocument(url, this.url);
  }

  /** The main frame failed to load, or the renderer went away. */
  lost(): void {
    this.#trusted = false;
  }

  get trusted(): boolean {
    return this.#trusted;
  }
}

/** Two URLs name the same document: equal once parsed, ignoring the hash. */
export function sameDocument(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;

  const left = new URL(a);
  const right = new URL(b);

  left.hash = "";
  right.hash = "";

  return left.href === right.href;
}

const pages = new Map<number, AppPage>();

/**
 * Bind `contents` to the app page at `url`: guard its top-frame navigation and
 * track whether it holds that page. Call before loading anything into it.
 */
export function registerAppPage(contents: WebContents, url: string): void {
  const page = new AppPage(url);
  const { id } = contents;

  pages.set(id, page);
  contents.once("destroyed", () => pages.delete(id));

  // will-navigate is main-frame only; will-redirect also fires for subframes,
  // whose navigation (the PDF preview's) is the viewer's own.
  contents.on("will-navigate", (event) => {
    if (!page.allows(event.url)) event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame && !page.allows(event.url)) event.preventDefault();
  });

  // did-navigate is main-frame, cross-document and successful only.
  contents.on("did-navigate", (_event, committed) => page.committed(committed));
  contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) page.lost();
  });
  contents.on("render-process-gone", () => page.lost());
}

/** The sender is the top frame of a window that holds the app page. */
export function fromAppPage(event: IpcMainInvokeEvent): boolean {
  const { sender, senderFrame } = event;

  return (
    pages.get(sender.id)?.trusted === true &&
    senderFrame !== null &&
    !senderFrame.detached &&
    senderFrame === sender.mainFrame
  );
}
