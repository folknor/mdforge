/**
 * Conversion info for CLI output
 * Tracks what decisions were made during conversion
 */

export interface FontInfo {
	name: string;
	source: "system" | "google" | "fallback-system" | "fallback-google";
	preferred?: string; // Original font if this is a fallback
}

export interface ConversionInfo {
	theme?: string | false;
	fontScale?: number;
	fonts: {
		heading?: FontInfo;
		body?: FontInfo;
		mono?: FontInfo;
	};
	stylesheet?: {
		type: "specified" | "auto" | "none";
		path?: string;
	};
	headerFooter?: {
		type: "css @page" | "puppeteer" | "none";
		header?: string;
		footer?: string;
	};
	output?: {
		path: string;
		pages?: number;
	};
	warnings: string[];
}

/**
 * Create empty conversion info
 */
export function createConversionInfo(): ConversionInfo {
	return {
		fonts: {},
		warnings: [],
	};
}

/**
 * Format conversion info for CLI display
 */
export function formatConversionInfo(info: ConversionInfo): string {
	const lines: string[] = [];

	// Theme
	if (info.theme !== undefined) {
		lines.push(`  theme: ${info.theme === false ? "none" : info.theme}`);
	}

	// Fonts
	const fontParts: string[] = [];
	for (const [role, font] of Object.entries(info.fonts)) {
		if (font) {
			const source = font.source.includes("system") ? "system" : "google";
			const fallbackNote = font.preferred
				? ` ← ${font.preferred} not found`
				: "";
			fontParts.push(`${role}: ${font.name} (${source})${fallbackNote}`);
		}
	}
	if (fontParts.length > 0) {
		lines.push(`  fonts: ${fontParts.join(", ")}`);
	} else if (info.theme === false) {
		lines.push("  fonts: none");
	}

	// Font scale
	if (info.fontScale && info.fontScale !== 1) {
		const scaledSize = 12 * info.fontScale;
		lines.push(`  font_scale: ${info.fontScale}× (${scaledSize}pt)`);
	}

	// Stylesheet
	if (info.stylesheet) {
		if (info.stylesheet.type === "auto" && info.stylesheet.path) {
			lines.push(`  stylesheet: ${info.stylesheet.path} (auto-detected)`);
		} else if (info.stylesheet.type === "specified" && info.stylesheet.path) {
			lines.push(`  stylesheet: ${info.stylesheet.path}`);
		}
	}

	// Header/Footer
	if (info.headerFooter && info.headerFooter.type !== "none") {
		const parts: string[] = [];
		if (info.headerFooter.header)
			parts.push(`header: "${info.headerFooter.header}"`);
		if (info.headerFooter.footer)
			parts.push(`footer: "${info.headerFooter.footer}"`);
		if (parts.length > 0) {
			lines.push(`  ${parts.join(", ")} (${info.headerFooter.type})`);
		}
	}

	return lines.join("\n");
}
