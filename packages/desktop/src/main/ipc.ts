import process from "node:process";
import { dialog, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { ConversionConfig, ConversionProgress, PreviewConfig } from "../types";
import { fromAppPage } from "./app-page";
import { convertFiles, generatePreview } from "./conversion";
import { beginPreview, stopPreviewWatch } from "./preview-watch";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[desktop:ipc]", ...args);
  }
}

// Every channel answers only the app's own page (see app-page.ts), checked
// before the handler does anything: the sender frame is only reliable
// synchronously, as it may navigate away during an await.
function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result,
): void {
  ipcMain.handle(channel, (event, ...args: Args) => {
    if (!fromAppPage(event)) {
      throw new Error(`Refused ${channel}: the request did not come from the app's page`);
    }

    return listener(event, ...args);
  });
}

export function setupIpcHandlers(): void {
  // File conversion
  // The renderer's batch token is echoed in every progress event: a batch
  // keeps running after a reload, and the reloaded page must be able to tell
  // its events from a new batch's.
  handle(
    "convert-files",
    async (event, batch: string, files: string[], config: ConversionConfig) => {
      log("convert-files IPC called, files:", files);
      const contents = event.sender;

      const results = await convertFiles(files, config, (file, progress) => {
        log("Progress:", file, progress);
        const message: ConversionProgress = { batch, file, progress };

        if (!contents.isDestroyed()) contents.send("conversion-progress", message);
      });

      log("Conversion complete, results:", results);

      return results;
    },
  );

  // Preview generation. Requesting a preview also watches the file and what
  // its preview depended on, for live preview (see preview-watch.ts).
  handle("generate-preview", async (event, filePath: string, config: PreviewConfig) => {
    log("generate-preview IPC called:", filePath);

    // Synchronously, before conversion, so edits during it are seen
    const request = beginPreview(event.sender, filePath);
    const { result, dependencies } = await generatePreview(filePath, config);

    request.complete(dependencies);

    return result;
  });

  handle("stop-preview-watch", (event) => {
    stopPreviewWatch(event.sender);
  });

  // File dialogs
  handle("select-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });

    return result.canceled ? [] : result.filePaths;
  });

  handle("select-output-dir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled ? null : result.filePaths[0];
  });
}
