import { type FSWatcher, watch } from "node:fs";
import process from "node:process";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { ConversionConfig, PreviewConfig } from "../types";
import { convertFiles, generatePreview } from "./conversion";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[desktop:ipc]", ...args);
  }
}

// Track file watchers per window
const fileWatchers: Map<string, FSWatcher> = new Map();

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

  // Preview generation
  ipcMain.handle("generate-preview", async (_event, filePath: string, config: PreviewConfig) => {
    log("generate-preview IPC called:", filePath);

    return generatePreview(filePath, config);
  });

  // File watching for live preview
  ipcMain.handle("watch-file", async (event, filePath: string) => {
    log("watch-file IPC called:", filePath);
    const window = BrowserWindow.fromWebContents(event.sender);

    // Clean up existing watcher for this file
    const existingWatcher = fileWatchers.get(filePath);

    if (existingWatcher) {
      existingWatcher.close();
      fileWatchers.delete(filePath);
    }

    // Create new watcher
    try {
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        if (eventType === "change") {
          log("File changed:", filePath);
          window?.webContents.send("file-changed", filePath);
        }
      });

      fileWatchers.set(filePath, watcher);
      log("Now watching:", filePath);
    } catch (error) {
      log("Watch error:", error);
    }
  });

  ipcMain.handle("unwatch-file", async (_event, filePath: string) => {
    log("unwatch-file IPC called:", filePath);
    const watcher = fileWatchers.get(filePath);

    if (watcher) {
      watcher.close();
      fileWatchers.delete(filePath);
      log("Stopped watching:", filePath);
    }
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
