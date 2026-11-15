import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ConversionConfig,
  ConversionProgress,
  ElectronAPI,
  PreviewConfig,
  WatchProblem,
} from "../types";

const electronAPI: ElectronAPI = {
  // Conversion
  convertFiles: (batch: string, files: string[], config: ConversionConfig) =>
    ipcRenderer.invoke("convert-files", batch, files, config),

  // Preview
  generatePreview: (filePath: string, config: PreviewConfig) =>
    ipcRenderer.invoke("generate-preview", filePath, config),
  stopPreviewWatch: () => ipcRenderer.invoke("stop-preview-watch"),

  // File dialogs
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectOutputDir: () => ipcRenderer.invoke("select-output-dir"),

  // File.path was removed in Electron 32; webUtils is its replacement.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Events
  onConversionProgress: (callback: (progress: ConversionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ConversionProgress): void => {
      callback(progress);
    };

    ipcRenderer.on("conversion-progress", handler);

    return () => {
      ipcRenderer.removeListener("conversion-progress", handler);
    };
  },
  onPreviewSourceChanged: (callback: () => void) => {
    const handler = (): void => {
      callback();
    };

    ipcRenderer.on("preview-source-changed", handler);

    return () => {
      ipcRenderer.removeListener("preview-source-changed", handler);
    };
  },
  onWatchProblems: (callback: (problems: WatchProblem[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, problems: WatchProblem[]): void => {
      callback(problems);
    };

    ipcRenderer.on("watch-problems", handler);

    return () => {
      ipcRenderer.removeListener("watch-problems", handler);
    };
  },
};

contextBridge.exposeInMainWorld("electron", electronAPI);
