/**
 * Font loading and pairings for mdforge
 *
 * Generates Google Fonts @import URLs and CSS variables for heading/body fonts.
 */

export interface FontConfig {
	heading?: string;
	body?: string;
}

/**
 * Named font pairings (presets)
 */
export const fontPairings: Record<string, FontConfig> = {
	"modern-professional": {
		heading: "Inter",
		body: "Inter",
	},
	"classic-elegant": {
		heading: "Playfair Display",
		body: "Libre Baskerville",
	},
	"modern-geometric": {
		heading: "Poppins",
		body: "Open Sans",
	},
	"tech-minimal": {
		heading: "Space Grotesk",
		body: "DM Sans",
	},
	editorial: {
		heading: "Cormorant Garamond",
		body: "Libre Baskerville",
	},
	"clean-sans": {
		heading: "DM Sans",
		body: "Inter",
	},
};

export type FontPairing = keyof typeof fontPairings;

/**
 * Encode font name for Google Fonts URL
 */
function encodeFontName(name: string): string {
	return name.replace(/ /g, "+");
}

/**
 * Generate Google Fonts @import URL for given fonts
 */
function generateGoogleFontsImport(fonts: FontConfig): string {
	const fontNames = new Set<string>();

	if (fonts.heading) fontNames.add(fonts.heading);
	if (fonts.body) fontNames.add(fonts.body);

	if (fontNames.size === 0) return "";

	// Build family parameter with weights
	// Include regular (400), medium (500), semibold (600), bold (700)
	const families = Array.from(fontNames)
		.map((name) => `family=${encodeFontName(name)}:wght@400;500;600;700`)
		.join("&");

	return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');`;
}

/**
 * Generate CSS variables and rules for fonts
 */
function generateFontCss(fonts: FontConfig): string {
	const lines: string[] = [];

	if (fonts.heading || fonts.body) {
		lines.push(":root {");
		if (fonts.heading) {
			lines.push(
				`  --font-heading: "${fonts.heading}", system-ui, sans-serif;`,
			);
		}
		if (fonts.body) {
			lines.push(`  --font-body: "${fonts.body}", system-ui, sans-serif;`);
		}
		lines.push("}");
		lines.push("");
	}

	if (fonts.body) {
		lines.push("body {");
		lines.push("  font-family: var(--font-body);");
		lines.push("}");
		lines.push("");
	}

	if (fonts.heading) {
		lines.push("h1, h2, h3, h4, h5, h6 {");
		lines.push("  font-family: var(--font-heading);");
		lines.push("}");
	}

	return lines.join("\n");
}

/**
 * Generate complete font CSS (import + rules) from config
 */
export function generateFontStylesheet(
	fonts?: FontConfig,
	fontPairing?: string,
): string | undefined {
	// Resolve font config from pairing name or direct config
	let resolvedFonts: FontConfig | undefined;

	if (fontPairing && fontPairing in fontPairings) {
		resolvedFonts = fontPairings[fontPairing];
	} else if (fonts && (fonts.heading || fonts.body)) {
		resolvedFonts = fonts;
	}

	if (!resolvedFonts) return undefined;

	const importStatement = generateGoogleFontsImport(resolvedFonts);
	const cssRules = generateFontCss(resolvedFonts);

	return `/* mdforge font loading */\n${importStatement}\n\n${cssRules}`;
}
