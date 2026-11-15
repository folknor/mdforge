import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { appFile, appScheme } from "./app-page";

/**
 * The packaged app page is served from its own scheme, not file://.
 *
 * Packaged builds turn Electron's grantFileProtocolExtraPrivileges fuse off
 * (electron-builder.yml), so that render pages, which stay on file://, get
 * Chrome's file rules: their scripts cannot fetch, XHR or iframe-read other
 * local files (docs/docs/reference/configuration.md, "Trust"). Without the
 * fuse a file:// page cannot load the module script and crossorigin
 * stylesheet Vite emits, so the app page moves to appPageUrl, which the
 * navigation guard and IPC trust (app-page.ts) compare against.
 *
 * The scheme is handled on the default session only; render windows use
 * their own partition and cannot reach it.
 */

/** Register the scheme's privileges; must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serve the files under `root` on the app scheme; call once the app is ready. */
export function serveAppScheme(root: string): void {
  protocol.handle(appScheme, async (request) => {
    const file = appFile(root, request.url);

    if (file === undefined) return new Response("Not found", { status: 404 });

    return net.fetch(pathToFileURL(file).href);
  });
}
