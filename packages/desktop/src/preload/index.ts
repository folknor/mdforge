import { contextBridge, ipcRenderer } from "electron";
import type {
	ConversionConfig,
	ConversionProgress,
	ElectronAPI,
} from "../types";

const electronAPI: ElectronAPI = {
	// Conversion
	convertFiles: (files: string[], config: ConversionConfig) =>
		ipcRenderer.invoke("convert-files", files, config),

	// File dialogs
	selectFiles: () => ipcRenderer.invoke("select-files"),
	selectFolder: () => ipcRenderer.invoke("select-folder"),
	selectOutputDir: () => ipcRenderer.invoke("select-output-dir"),

	// Preferences
	getPreferences: () => ipcRenderer.invoke("get-preferences"),
	setPreferences: (prefs) => ipcRenderer.invoke("set-preferences", prefs),

	// Events
	onConversionProgress: (callback: (progress: ConversionProgress) => void) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			progress: ConversionProgress,
		): void => {
			callback(progress);
		};
		ipcRenderer.on("conversion-progress", handler);
		return () => {
			ipcRenderer.removeListener("conversion-progress", handler);
		};
	},
};

contextBridge.exposeInMainWorld("electron", electronAPI);
