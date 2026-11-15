import { join } from "node:path";
import process from "node:process";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, shell } from "electron";
import { appPageUrl, registerAppPage } from "./app-page";
import { registerAppScheme, serveAppScheme } from "./app-protocol";
import { setupIpcHandlers } from "./ipc";

// Scheme privileges can only be registered before the app is ready.
registerAppScheme();

// The main process is bundled as ESM, where __dirname does not exist. Use
// import.meta.dirname rather than relying on a bundler-injected shim, which
// differs between Vite's rollup and rolldown backends.
const currentDir: string = import.meta.dirname;

let mainWindow: BrowserWindow | null = null;

const externalProtocols: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

async function openExternalIfSafe(url: string): Promise<void> {
  if (!URL.canParse(url) || !externalProtocols.has(new URL(url).protocol)) {
    return;
  }

  try {
    await shell.openExternal(url);
  } catch {
    console.error("Failed to open external URL:", url);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // A sandboxed preload runs as a plain script, not an ES module, so it is
      // built as CommonJS (vite.config.ts). It only needs contextBridge,
      // ipcRenderer and webUtils, which the sandbox provides.
      preload: join(currentDir, "../preload/index.cjs"),
      sandbox: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // The window only ever shows the app's own page. Links opened from it go to
  // the system handler, but only for schemes that hand the URL to a browser or
  // mail client rather than to an arbitrary registered application.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalIfSafe(details.url);

    return { action: "deny" };
  });

  // The renderer's URL. vite-plugin-electron exposes the dev server URL as
  // VITE_DEV_SERVER_URL; in a packaged build it is unset and the built page is
  // served on the app scheme (app-protocol.ts). It is fixed here, not read
  // back from the window, and loaded as given, so the navigation guard and the
  // IPC check compare against the URL we chose.
  const devUrl = process.env["VITE_DEV_SERVER_URL"];

  const appUrl = is.dev && devUrl ? devUrl : appPageUrl;

  // The top frame never leaves the app's page, by navigation or redirect; a
  // reload of it (Vite's full reload in dev calls location.reload()) passes.
  // Navigation inside the PDF preview's iframe is the viewer's own.
  registerAppPage(mainWindow.webContents, appUrl);
  mainWindow.loadURL(appUrl);
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.mdforge.desktop");

  // Default open or close DevTools by F12 in development
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  serveAppScheme(join(currentDir, "../renderer"));
  setupIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
