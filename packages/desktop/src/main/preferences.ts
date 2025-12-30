import Store from "electron-store";
import type { UserPreferences } from "../types";

const store = new Store<UserPreferences>({
	defaults: {
		defaultTheme: "beryl",
		defaultFontPairing: "",
		defaultAuthor: "",
		lastOutputDir: "",
		rememberLastDir: true,
	},
});

export function getPreferences(): UserPreferences {
	return {
		defaultTheme: store.get("defaultTheme"),
		defaultFontPairing: store.get("defaultFontPairing"),
		defaultAuthor: store.get("defaultAuthor"),
		lastOutputDir: store.get("lastOutputDir"),
		rememberLastDir: store.get("rememberLastDir"),
	};
}

export function setPreferences(prefs: Partial<UserPreferences>): void {
	for (const [key, value] of Object.entries(prefs)) {
		store.set(key as keyof UserPreferences, value);
	}
}
