import { join, posix, sep } from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import type { Config, HtmlConfig, PdfConfig } from "./config.js";
import { isHttpUrl } from "./is-http-url.js";

export type Output = PdfOutput | HtmlOutput;

export interface PdfOutput extends BasicOutput {
	content: Buffer | Uint8Array;
}

export interface HtmlOutput extends BasicOutput {
	content: string;
}

interface BasicOutput {
	filename: string | undefined;
}

/**
 * Store a single browser instance reference so that we can re-use it.
 */
let browserPromise: Promise<Browser> | undefined;

/**
 * Close the browser instance.
 */
export const closeBrowser = async () => (await browserPromise)?.close();

/**
 * Generate the output (either PDF or HTML).
 */
export async function generateOutput(
	html: string,
	relativePath: string,
	config: PdfConfig,
	browserRef?: Browser,
): Promise<PdfOutput>;
export async function generateOutput(
	html: string,
	relativePath: string,
	config: HtmlConfig,
	browserRef?: Browser,
): Promise<HtmlOutput>;
export async function generateOutput(
	html: string,
	relativePath: string,
	config: Config,
	browserRef?: Browser,
): Promise<Output>;
export async function generateOutput(
	html: string,
	relativePath: string,
	config: Config,
	browserRef?: Browser,
): Promise<Output> {
	async function getBrowser() {
		if (browserRef) {
			return browserRef;
		}

		if (!browserPromise) {
			browserPromise = puppeteer.launch({
				devtools: config.devtools,
				...config.launch_options,
			});
		}

		return browserPromise;
	}

	const browser = await getBrowser();

	const page = await browser.newPage();

	const urlPathname = join(relativePath, "index.html")
		.split(sep)
		.join(posix.sep);

	// Ensure port is defined (should be set by caller)
	if (!config.port) {
		throw new Error("Port must be defined before calling generateOutput");
	}
	await page.goto(`http://localhost:${config.port}/${urlPathname}`); // make sure relative paths work as expected
	await page.setContent(html); // overwrite the page content with what was generated from the markdown

	for (const stylesheet of config.stylesheet) {
		await page.addStyleTag(
			isHttpUrl(stylesheet) ? { url: stylesheet } : { path: stylesheet },
		);
	}

	if (config.css) {
		await page.addStyleTag({ content: config.css });
	}

	for (const scriptTagOptions of config.script) {
		await page.addScriptTag(scriptTagOptions);
	}

	// Wait for network to be idle
	await page.waitForNetworkIdle();

	let outputFileContent: string | Buffer | Uint8Array = "";

	if (config.devtools) {
		await new Promise((resolve) => page.on("close", resolve));
	} else if (config.as_html) {
		outputFileContent = await page.content();
	} else {
		await page.emulateMediaType(config.page_media_type);
		outputFileContent = await page.pdf(config.pdf_options);
	}

	await page.close();

	return config.devtools
		? { filename: undefined, content: "" } // Special case for devtools mode - return empty content
		: config.as_html
			? { filename: config.dest, content: outputFileContent as string }
			: {
					filename: config.dest,
					content: outputFileContent as Buffer | Uint8Array,
				};
}
