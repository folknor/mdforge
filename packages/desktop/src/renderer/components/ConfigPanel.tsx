import type { UserPreferences } from "../../types";

// Available themes from @mdforge/core
const THEMES = ["beryl", "tufte", "buttondown", "pandoc"];

// Available font pairings
const FONT_PAIRINGS = [
	{ value: "", label: "Default" },
	{ value: "inter-source", label: "Inter + Source Code Pro" },
	{ value: "georgia-mono", label: "Georgia + JetBrains Mono" },
	{ value: "system", label: "System Fonts" },
];

interface ConfigPanelProps {
	preferences: UserPreferences;
	onChange: (prefs: Partial<UserPreferences>) => void;
}

export default function ConfigPanel({
	preferences,
	onChange,
}: ConfigPanelProps) {
	return (
		<div className="mt-6 bg-white rounded-lg shadow p-4">
			<h2 className="font-medium text-gray-800 mb-4">Settings</h2>

			<div className="space-y-4">
				<div>
					<label
						htmlFor="theme-select"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Theme
					</label>
					<select
						id="theme-select"
						value={preferences.defaultTheme}
						onChange={(e) => onChange({ defaultTheme: e.target.value })}
						className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						{THEMES.map((theme) => (
							<option key={theme} value={theme}>
								{theme.charAt(0).toUpperCase() + theme.slice(1)}
							</option>
						))}
					</select>
				</div>

				<div>
					<label
						htmlFor="font-pairing-select"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Font Pairing
					</label>
					<select
						id="font-pairing-select"
						value={preferences.defaultFontPairing}
						onChange={(e) => onChange({ defaultFontPairing: e.target.value })}
						className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						{FONT_PAIRINGS.map((fp) => (
							<option key={fp.value} value={fp.value}>
								{fp.label}
							</option>
						))}
					</select>
				</div>

				<div>
					<label
						htmlFor="author-input"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Default Author
					</label>
					<input
						id="author-input"
						type="text"
						value={preferences.defaultAuthor}
						onChange={(e) => onChange({ defaultAuthor: e.target.value })}
						placeholder="Your name"
						className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>

				<div className="flex items-center">
					<input
						type="checkbox"
						id="rememberDir"
						checked={preferences.rememberLastDir}
						onChange={(e) => onChange({ rememberLastDir: e.target.checked })}
						className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
					/>
					<label htmlFor="rememberDir" className="ml-2 text-sm text-gray-700">
						Remember last output folder
					</label>
				</div>
			</div>
		</div>
	);
}
