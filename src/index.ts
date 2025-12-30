import puppeteer from "puppeteer";
import { type Config, defaultConfig } from "./lib/config.js";
import type { Output } from "./lib/generate-output.js";
import { convertMdToPdf } from "./lib/md-to-pdf.js";
import { getDir } from "./lib/util.js";

type Input = { content: string } | { path: string };

/**
 * Convert markdown to PDF or HTML (library API).
 */
export async function mdToPdf(
	input: Input,
	config: Partial<Config> = {},
): Promise<Output> {
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
