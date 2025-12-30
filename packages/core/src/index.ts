import puppeteer from "puppeteer";
import { type Config, defaultConfig } from "./lib/config.js";
import { type ConvertResult, convertMdToPdf } from "./lib/convert.js";
import { getDir } from "./lib/util.js";

// Re-export types and utilities for CLI and other consumers
export { type Config, defaultConfig } from "./lib/config.js";
export {
	type ConversionInfo,
	formatConversionInfo,
} from "./lib/conversion-info.js";
export { type ConvertResult, convertMdToPdf } from "./lib/convert.js";
export type { FontConfig, FontPairing } from "./lib/fonts.js";
export { closeBrowser, type Output } from "./lib/generate-output.js";
export type { TemplatesConfig } from "./lib/includes.js";
// Re-export types that might be useful
export type { PdfMetadata } from "./lib/pdf-metadata.js";
export { resolveFileRefs } from "./lib/util.js";

type Input = { content: string } | { path: string };

/**
 * Convert markdown to PDF or HTML (library API).
 */
export async function mdToPdf(
	input: Input,
	config: Partial<Config> = {},
): Promise<ConvertResult> {
	const mergedConfig: Config = {
		...defaultConfig,
		...config,
		basedir:
			config.basedir ?? ("path" in input ? getDir(input.path) : process.cwd()),
		dest: config.dest ?? "",
		pdf_options: { ...defaultConfig.pdf_options, ...config.pdf_options },
	};

	const browser = await puppeteer.launch(mergedConfig.launch_options);
	const result = await convertMdToPdf(input, mergedConfig, { browser });
	await browser.close();

	return result;
}

export default mdToPdf;
