import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import { addAcroFormFields } from "./acroform.js";
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

	// Extract select options if fillable mode is enabled
	// (Select options are not encoded in marker URLs, so we need to extract them from DOM)
	let selectOptions: Map<string, string[]> | undefined;
	if (config.fillable && !config.as_html) {
		const selectData = await page.evaluate(() => {
			const selects = document.querySelectorAll("[data-form-field][data-field-type='select'] select");
			const result: Array<{ name: string; options: string[] }> = [];
			for (let i = 0; i < selects.length; i++) {
				const select = selects[i];
				if (!select) continue;
				const wrapper = select.closest("[data-form-field]");
				const name = wrapper?.getAttribute("data-field-name");
				if (!name) continue;
				const options = Array.from((select as HTMLSelectElement).options).map(
					(opt) => opt.value || opt.text
				);
				result.push({ name, options });
			}
			return result;
		});
		if (selectData.length > 0) {
			selectOptions = new Map(selectData.map((s) => [s.name, s.options]));
		}
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

	// Add AcroForm fields if fillable mode is enabled
	// The marker-based approach reads field positions from PDF link annotations
	if (config.fillable) {
		pdfContent = await addAcroFormFields(Buffer.from(pdfContent), {
			selectOptions,
		});
	}

	return {
		filename: config.dest,
		content: pdfContent,
	};
}
