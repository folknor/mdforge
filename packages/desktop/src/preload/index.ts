import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ConversionConfig, ConversionProgress, ElectronAPI, PreviewConfig } from "../types";

const electronAPI: ElectronAPI = {
  // Conversion
  convertFiles: (files: string[], config: ConversionConfig) =>
    ipcRenderer.invoke("convert-files", files, config),

  // Preview
  generatePreview: (filePath: string, config: PreviewConfig) =>
    ipcRenderer.invoke("generate-preview", filePath, config),
  watchFile: (filePath: string) => ipcRenderer.invoke("watch-file", filePath),
  unwatchFile: (filePath: string) => ipcRenderer.invoke("unwatch-file", filePath),

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
  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string): void => {
      callback(filePath);
    };

    ipcRenderer.on("file-changed", handler);

    return () => {
      ipcRenderer.removeListener("file-changed", handler);
    };
  },
};

contextBridge.exposeInMainWorld("electron", electronAPI);
