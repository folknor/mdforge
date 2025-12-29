import puppeteer from "puppeteer";
import {
	type Config,
	defaultConfig,
	type HtmlConfig,
	type PdfConfig,
} from "./lib/config.js";
import type { HtmlOutput, Output, PdfOutput } from "./lib/generate-output.js";
import { getDir } from "./lib/helpers.js";
import { convertMdToPdf } from "./lib/md-to-pdf.js";

type Input = ContentInput | PathInput;

interface ContentInput {
	content: string;
}

interface PathInput {
	path: string;
}

const hasContent = (input: Input): input is ContentInput => "content" in input;
const hasPath = (input: Input): input is PathInput => "path" in input;

/**
 * Convert a markdown file to PDF.
 */
export async function mdToPdf(
	input: ContentInput | PathInput,
	config?: Partial<PdfConfig>,
): Promise<PdfOutput>;
export async function mdToPdf(
	input: ContentInput | PathInput,
	config?: Partial<HtmlConfig>,
): Promise<HtmlOutput>;
export async function mdToPdf(
	input: Input,
	config: Partial<Config> = {},
): Promise<Output> {
	if (!hasContent(input) && !hasPath(input)) {
		throw new Error(
			'The input is missing one of the properties "content" or "path".',
		);
	}

	if (!config.basedir) {
		config.basedir = "path" in input ? getDir(input.path) : process.cwd();
	}

	if (!config.dest) {
		config.dest = "";
	}

	const mergedConfig: Config = {
		...defaultConfig,
		...config,
		pdf_options: { ...defaultConfig.pdf_options, ...config.pdf_options },
	};

	const browser = await puppeteer.launch(config.launch_options);

	const pdf = await convertMdToPdf(input, mergedConfig, { browser });

	await browser.close();

	return pdf;
}

export default mdToPdf;
