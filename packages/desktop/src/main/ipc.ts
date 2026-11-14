import process from "node:process";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { ConversionConfig, PreviewConfig } from "../types";
import { convertFiles, generatePreview } from "./conversion";
import { beginPreview, stopPreviewWatch } from "./preview-watch";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[desktop:ipc]", ...args);
  }
}

export function setupIpcHandlers(): void {
  // File conversion
  ipcMain.handle("convert-files", async (event, files: string[], config: ConversionConfig) => {
    log("convert-files IPC called, files:", files);
    const window = BrowserWindow.fromWebContents(event.sender);

    const results = await convertFiles(files, config, (file, progress) => {
      log("Progress:", file, progress);
      window?.webContents.send("conversion-progress", { file, progress });
    });

    log("Conversion complete, results:", results);

    return results;
  });

  // Preview generation. Requesting a preview also watches the file and what
  // its preview depended on, for live preview (see preview-watch.ts).
  ipcMain.handle("generate-preview", async (event, filePath: string, config: PreviewConfig) => {
    log("generate-preview IPC called:", filePath);

    // Synchronously, before conversion, so edits during it are seen
    const request = beginPreview(event.sender, filePath);
    const { result, dependencies } = await generatePreview(filePath, config);

    request.complete(dependencies);

    return result;
  });

  ipcMain.handle("stop-preview-watch", (event) => {
    stopPreviewWatch(event.sender);
  });

  // File dialogs
  ipcMain.handle("select-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("select-output-dir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? null : result.filePaths[0];
  });
}
