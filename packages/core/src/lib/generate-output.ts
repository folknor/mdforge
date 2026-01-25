import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import {
	type FieldPosition,
	addAcroFormFields,
	extractFieldPositionsScript,
	getMarginMm,
} from "./acroform.js";
import type { Config } from "./config.js";
import { injectPdfMetadata } from "./pdf-metadata.js";
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
export const closeBrowser = async (): Promise<void> => {
	await (await browserPromise)?.close();
};

/**
 * Generate the output (either PDF or HTML).
 */
export async function generateOutput(
	html: string,
	relativePath: string,
	config: Config,
	browserRef?: Browser,
): Promise<Output> {
	async function getBrowser(): Promise<Browser> {
		// biome-ignore lint/nursery/noUnnecessaryConditions: browserRef is an optional param that may be undefined
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

	// Extract field positions if fillable mode is enabled
	let fieldPositions: FieldPosition[] = [];
	if (config.fillable && !config.as_html) {
		fieldPositions = await page.evaluate(extractFieldPositionsScript);
	}

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

	// Inject PDF metadata if configured
	let pdfContent = outputFileContent as Buffer | Uint8Array;
	if (config.metadata) {
		const metadata = {
			...config.metadata,
			// Use document_title as fallback for metadata title
			title: config.metadata.title || config.document_title || undefined,
			// Set creator to mdforge if not specified
			creator: config.metadata.creator || "mdforge",
		};
		// Only inject if there's meaningful metadata
		if (
			metadata.title ||
			metadata.author ||
			metadata.subject ||
			metadata.keywords?.length
		) {
			pdfContent = await injectPdfMetadata(Buffer.from(pdfContent), metadata);
		}
	}

	// Add AcroForm fields if fillable mode is enabled and we have field positions
	if (config.fillable && fieldPositions.length > 0) {
		const marginMm = getMarginMm(config.pdf_options.margin);
		pdfContent = await addAcroFormFields(Buffer.from(pdfContent), fieldPositions, {
			marginMm,
		});
	}

	return {
		filename: config.dest,
		content: pdfContent,
	};
}
