import { fontPairingPresets, type Theme, themes } from "@mdforge/renderer-electron/browser";
import type React from "react";

interface ConfigPanelProps {
  theme: Theme;
  fontPairing: string;
  author: string;
  onThemeChange: (theme: Theme) => void;
  onFontPairingChange: (fontPairing: string) => void;
  onAuthorChange: (author: string) => void;
}

export default function ConfigPanel({
  theme,
  fontPairing,
  author,
  onThemeChange,
  onFontPairingChange,
  onAuthorChange,
}: ConfigPanelProps): React.ReactElement {
  return (
    <div className="mt-6 bg-white rounded-lg shadow p-4">
      <h2 className="font-medium text-gray-800 mb-4">Settings</h2>

      <div className="space-y-4">
        <div>
          <label htmlFor="theme-select" className="block text-sm font-medium text-gray-700 mb-1">
            Theme
          </label>
          <select
            id="theme-select"
            value={theme}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
              const selected = themes.find((t) => t === e.target.value);

              if (selected) {
                onThemeChange(selected);
              }
            }}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {themes.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
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
            value={fontPairing}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>): void =>
              onFontPairingChange(e.target.value)
            }
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {fontPairingPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="author-input" className="block text-sm font-medium text-gray-700 mb-1">
            Author
          </label>
          <input
            id="author-input"
            type="text"
            value={author}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
              onAuthorChange(e.target.value)
            }
            placeholder="Your name"
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
