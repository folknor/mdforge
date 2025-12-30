import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import type { Config } from "./config.js";
import { isHttpUrl } from "./util.js";

export type Output = PdfOutput | HtmlOutput;

export interface PdfOutput extends BasicOutput {
	content: Buffer | Uint8Array;
}

export interface HtmlOutput extends BasicOutput {
	content: string;
	headerTemplate?: string;
	footerTemplate?: string;
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
	config: Config,
	browserRef?: Browser,
): Promise<Output> {
	async function getBrowser() {
		if (browserRef) {
			return browserRef;
		}

		if (!browserPromise) {
			browserPromise = puppeteer.launch(config.launch_options);
		}

		return browserPromise;
	}

	const browser = await getBrowser();

	const page = await browser.newPage();

	// Inject <base> tag so relative paths in markdown resolve correctly
	const baseUrl = pathToFileURL(
		`${resolve(config.basedir, relativePath)}/`,
	).href;
	const htmlWithBase = html.replace("<head>", `<head><base href="${baseUrl}">`);
	await page.setContent(htmlWithBase, { waitUntil: "domcontentloaded" });

	for (const stylesheet of config.stylesheet) {
		// If stylesheet contains newlines or {, it's CSS content (from @file resolution)
		// Otherwise it's a URL or path
		const isCssContent = stylesheet.includes("\n") || stylesheet.includes("{");
		await page.addStyleTag(
			isHttpUrl(stylesheet)
				? { url: stylesheet }
				: isCssContent
					? { content: stylesheet }
					: { path: stylesheet },
		);
	}

	for (const scriptTagOptions of config.script) {
		await page.addScriptTag(scriptTagOptions);
	}

	// Wait for network to be idle
	await page.waitForNetworkIdle();

	let outputFileContent: string | Buffer | Uint8Array;

	if (config.as_html) {
		outputFileContent = await page.content();
	} else {
		await page.emulateMediaType(config.page_media_type);
		const pdfOptions = {
			...config.pdf_options,
			outline: true,
		};
		outputFileContent = await page.pdf(pdfOptions);
	}

	await page.close();

	if (config.as_html) {
		return {
			filename: config.dest,
			content: outputFileContent as string,
			headerTemplate: config.pdf_options.headerTemplate,
			footerTemplate: config.pdf_options.footerTemplate,
		};
	}

	return {
		filename: config.dest,
		content: outputFileContent as Buffer | Uint8Array,
	};
}
