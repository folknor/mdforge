import { join } from "node:path";
import process from "node:process";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, shell } from "electron";
import { setupIpcHandlers } from "./ipc";

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

  // The top frame never leaves the app's page. A reload of that page (Vite's
  // full reload in dev calls location.reload(), which arrives here) is let
  // through. This guards the top frame only; navigation inside the PDF
  // preview's iframe is the viewer's own.
  const contents = mainWindow.webContents;

  contents.on("will-navigate", (event) => {
    if (event.url !== contents.getURL()) {
      event.preventDefault();
    }
  });

  // Load the renderer. vite-plugin-electron exposes the dev server URL as
  // VITE_DEV_SERVER_URL; in a packaged build it is unset and we load the file.
  const rendererUrl = process.env["VITE_DEV_SERVER_URL"];

  if (is.dev && rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.mdforge.desktop");

  // Default open or close DevTools by F12 in development
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

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
