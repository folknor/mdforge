import { BrowserWindow, dialog, ipcMain } from "electron";
import type { ConversionConfig } from "../types";
import { convertFiles } from "./conversion";
import { getPreferences, setPreferences } from "./preferences";

export function setupIpcHandlers(): void {
	// File conversion
	ipcMain.handle(
		"convert-files",
		async (event, files: string[], config: ConversionConfig) => {
			const window = BrowserWindow.fromWebContents(event.sender);

			const results = await convertFiles(files, config, (file, progress) => {
				window?.webContents.send("conversion-progress", { file, progress });
			});

			return results;
		},
	);

	// File dialogs
	ipcMain.handle("select-files", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
		});
		return result.canceled ? [] : result.filePaths;
	});

	ipcMain.handle("select-folder", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory"],
		});
		return result.canceled ? null : result.filePaths[0];
	});

	ipcMain.handle("select-output-dir", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory", "createDirectory"],
		});
		return result.canceled ? null : result.filePaths[0];
	});

	// Preferences
	ipcMain.handle("get-preferences", async () => {
		return getPreferences();
	});

	ipcMain.handle("set-preferences", async (_event, prefs) => {
		setPreferences(prefs);
	});
}
