/**
 * AcroForm field generation for fillable PDFs.
 *
 * This module post-processes Puppeteer-generated PDFs to add real
 * AcroForm fields, making them fillable in PDF readers.
 */

import { type PDFPage, PDFDocument, rgb } from "pdf-lib";

/**
 * Position information for a form field extracted from the DOM.
 */
export interface FieldPosition {
	name: string;
	type: "text" | "textarea" | "select" | "checkbox" | "radio";
	x: number;
	y: number;
	width: number;
	height: number;
	/** For select fields: list of options */
	options?: string[];
	/** For checkbox/radio fields: the value attribute */
	value?: string;
}

/**
 * PDF page dimensions.
 */
export interface PdfPageInfo {
	width: number;
	height: number;
}

/**
 * Configuration for AcroForm field generation.
 */
export interface AcroFormConfig {
	/** PDF margins in mm (used for coordinate mapping) */
	marginMm?: number;
	/** Content area height in pixels (for multi-page support) */
	contentHeightPx?: number;
}

/**
 * Add AcroForm fields to a PDF at the specified positions.
 *
 * @param pdfBuffer - The PDF buffer to modify
 * @param fields - Array of field positions extracted from the DOM
 * @param config - Optional configuration
 * @returns Modified PDF buffer with AcroForm fields
 */
export async function addAcroFormFields(
	pdfBuffer: Buffer | Uint8Array,
	fields: FieldPosition[],
	config: AcroFormConfig = {},
): Promise<Uint8Array> {
	const { marginMm = 20, contentHeightPx } = config;

	const pdfDoc = await PDFDocument.load(pdfBuffer);
	const pages = pdfDoc.getPages();
	if (pages.length === 0) {
		// No pages in PDF, return unchanged
		return pdfDoc.save();
	}
	const firstPage = pages[0];
	if (!firstPage) {
		return pdfDoc.save();
	}
	const { height: pdfHeight } = firstPage.getSize();
	const form = pdfDoc.getForm();

	// Convert margin from mm to points (72 points per inch, 25.4 mm per inch)
	const marginPt = marginMm * (72 / 25.4);

	// HTML uses 96 DPI, PDF uses 72 DPI
	const scale = 72 / 96;

	// Calculate page height in pixels for multi-page support
	// If contentHeightPx is provided, use it to determine page breaks
	const pageHeightPx = contentHeightPx || (pdfHeight - 2 * marginPt) / scale;

	/**
	 * Get the PDF page and Y coordinate for a field based on its DOM Y position.
	 */
	function getPageAndY(domY: number, domHeight: number): { page: PDFPage; pdfY: number } | null {
		const pageIndex = Math.floor(domY / pageHeightPx);
		const yOnPage = domY - pageIndex * pageHeightPx;
		const page = pages[pageIndex];
		if (!page) return null;
		// Convert to PDF coordinates (bottom-left origin)
		const pdfY = pdfHeight - marginPt - (yOnPage + domHeight) * scale;
		return { page, pdfY };
	}

	// Group checkbox/radio fields by name for proper handling
	const radioGroups = new Map<string, FieldPosition[]>();
	const checkboxGroups = new Map<string, FieldPosition[]>();
	const simpleFields: FieldPosition[] = [];

	for (const field of fields) {
		if (field.type === "radio") {
			const group = radioGroups.get(field.name) || [];
			group.push(field);
			radioGroups.set(field.name, group);
		} else if (field.type === "checkbox" && field.value) {
			// Checkbox with value = part of a group
			const group = checkboxGroups.get(field.name) || [];
			group.push(field);
			checkboxGroups.set(field.name, group);
		} else {
			simpleFields.push(field);
		}
	}

	// Add simple fields (text, textarea, select, single checkboxes)
	for (const field of simpleFields) {
		const pageInfo = getPageAndY(field.y, field.height);
		if (!pageInfo) continue;

		const pdfX = marginPt + field.x * scale;
		const pdfW = field.width * scale;
		const pdfH = field.height * scale;

		try {
			if (field.type === "text" || field.type === "textarea") {
				const textField = form.createTextField(field.name);
				textField.addToPage(pageInfo.page, {
					x: pdfX,
					y: pageInfo.pdfY,
					width: pdfW,
					height: pdfH,
					borderColor: rgb(0.6, 0.6, 0.6),
					borderWidth: 0,
				});
				if (field.type === "textarea") {
					textField.enableMultiline();
				}
			} else if (field.type === "select" && field.options) {
				const dropdown = form.createDropdown(field.name);
				dropdown.addOptions(field.options);
				dropdown.addToPage(pageInfo.page, {
					x: pdfX,
					y: pageInfo.pdfY,
					width: pdfW,
					height: pdfH,
					borderColor: rgb(0.6, 0.6, 0.6),
					borderWidth: 0,
				});
			} else if (field.type === "checkbox") {
				const size = Math.min(pdfW, pdfH);
				const checkbox = form.createCheckBox(field.name);
				checkbox.addToPage(pageInfo.page, {
					x: pdfX,
					y: pageInfo.pdfY,
					width: size,
					height: size,
					borderColor: rgb(0.6, 0.6, 0.6),
					borderWidth: 0,
				});
			}
		} catch {
			// Field creation may fail if name already exists - skip silently
		}
	}

	// Add radio button groups
	for (const [name, options] of radioGroups) {
		try {
			const radioGroup = form.createRadioGroup(name);
			for (const opt of options) {
				const pageInfo = getPageAndY(opt.y, opt.height);
				if (!pageInfo) continue;

				const pdfX = marginPt + opt.x * scale;
				const size = Math.min(opt.width, opt.height) * scale;

				radioGroup.addOptionToPage(opt.value || opt.name, pageInfo.page, {
					x: pdfX,
					y: pageInfo.pdfY,
					width: size,
					height: size,
					borderColor: rgb(0.6, 0.6, 0.6),
					borderWidth: 0,
				});
			}
		} catch {
			// Radio group creation may fail - skip silently
		}
	}

	// Add checkbox groups (each checkbox needs unique name)
	for (const [name, options] of checkboxGroups) {
		for (const opt of options) {
			const pageInfo = getPageAndY(opt.y, opt.height);
			if (!pageInfo) continue;

			try {
				const pdfX = marginPt + opt.x * scale;
				const size = Math.min(opt.width, opt.height) * scale;

				const checkbox = form.createCheckBox(`${name}_${opt.value}`);
				checkbox.addToPage(pageInfo.page, {
					x: pdfX,
					y: pageInfo.pdfY,
					width: size,
					height: size,
					borderColor: rgb(0.6, 0.6, 0.6),
					borderWidth: 0,
				});
			} catch {
				// Checkbox creation may fail - skip silently
			}
		}
	}

	return pdfDoc.save();
}

/**
 * JavaScript code to inject into the page for extracting field positions.
 * Returns an array of FieldPosition objects.
 *
 * Note: This function is serialized and executed in the browser context via page.evaluate().
 * The return type annotation is for documentation - the actual function runs in the browser.
 */
export function extractFieldPositionsScript(): FieldPosition[] {
	const fields = document.querySelectorAll("[data-form-field]");
	const positions: Array<{
		name: string;
		type: "text" | "textarea" | "select" | "checkbox" | "radio";
		x: number;
		y: number;
		width: number;
		height: number;
		options?: string[];
		value?: string;
	}> = [];

	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (!field) continue;

		const name = field.getAttribute("data-field-name");
		const type = field.getAttribute("data-field-type") as
			| "text"
			| "textarea"
			| "select"
			| "checkbox"
			| "radio";
		const value = field.getAttribute("data-field-value") || undefined;

		if (!name || !type) continue;

		// Find the actual input element for positioning
		const input = field.querySelector("input, textarea, select");
		if (!input) continue;

		const rect = input.getBoundingClientRect();

		// For select fields, extract options
		let options: string[] | undefined;
		if (type === "select") {
			const selectEl = input as HTMLSelectElement;
			options = Array.from(selectEl.options).map((opt) => opt.value || opt.text);
		}

		positions.push({
			name,
			type,
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			options,
			value,
		});
	}

	return positions;
}

/**
 * Standard PDF page sizes in mm.
 */
const PDF_PAGE_SIZES: Record<string, { width: number; height: number }> = {
	letter: { width: 215.9, height: 279.4 },
	legal: { width: 215.9, height: 355.6 },
	tabloid: { width: 279.4, height: 431.8 },
	ledger: { width: 431.8, height: 279.4 },
	a0: { width: 841, height: 1189 },
	a1: { width: 594, height: 841 },
	a2: { width: 420, height: 594 },
	a3: { width: 297, height: 420 },
	a4: { width: 210, height: 297 },
	a5: { width: 148, height: 210 },
	a6: { width: 105, height: 148 },
};

/**
 * Get PDF content area dimensions in pixels at 96 DPI.
 * This is used to set the viewport for accurate position extraction.
 */
export function getPdfContentDimensions(pdfOptions: {
	format?: string;
	width?: string | number;
	height?: string | number;
	margin?: { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number } | string | number;
	landscape?: boolean;
}): { width: number; height: number } {
	// Get page size in mm
	let pageWidthMm: number;
	let pageHeightMm: number;

	if (pdfOptions.width && pdfOptions.height) {
		pageWidthMm = parseLengthToMm(pdfOptions.width);
		pageHeightMm = parseLengthToMm(pdfOptions.height);
	} else {
		const format = (pdfOptions.format || "a4").toLowerCase();
		const size = PDF_PAGE_SIZES[format] ?? { width: 210, height: 297 }; // Default to A4
		pageWidthMm = size.width;
		pageHeightMm = size.height;
	}

	// Handle landscape
	if (pdfOptions.landscape) {
		[pageWidthMm, pageHeightMm] = [pageHeightMm, pageWidthMm];
	}

	// Get margins
	const marginMm = getMarginMm(pdfOptions.margin);

	// Calculate content area in mm
	const contentWidthMm = pageWidthMm - 2 * marginMm;
	const contentHeightMm = pageHeightMm - 2 * marginMm;

	// Convert to pixels at 96 DPI
	const mmToPixels = 96 / 25.4;
	return {
		width: contentWidthMm * mmToPixels,
		height: contentHeightMm * mmToPixels,
	};
}

/**
 * Parse a length value to mm.
 */
function parseLengthToMm(value: string | number): number {
	if (typeof value === "number") {
		// Assume pixels, convert to mm
		return value * (25.4 / 96);
	}

	const mmMatch = value.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
	if (mmMatch?.[1]) return Number.parseFloat(mmMatch[1]);

	const cmMatch = value.match(/^(\d+(?:\.\d+)?)\s*cm$/i);
	if (cmMatch?.[1]) return Number.parseFloat(cmMatch[1]) * 10;

	const inMatch = value.match(/^(\d+(?:\.\d+)?)\s*in$/i);
	if (inMatch?.[1]) return Number.parseFloat(inMatch[1]) * 25.4;

	const pxMatch = value.match(/^(\d+(?:\.\d+)?)\s*px$/i);
	if (pxMatch?.[1]) return Number.parseFloat(pxMatch[1]) * (25.4 / 96);

	return 210; // Default to A4 width
}

/**
 * Get the margin in mm from Puppeteer PDF options.
 */
export function getMarginMm(
	margin:
		| { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number }
		| string
		| number
		| undefined,
): number {
	if (!margin) return 20; // Default 20mm

	// If it's a number, assume pixels and convert (96 DPI -> mm)
	if (typeof margin === "number") {
		return margin * (25.4 / 96);
	}

	// If it's a string, parse it
	if (typeof margin === "string") {
		return parseMarginValue(margin);
	}

	// If it's an object, use top margin as reference
	const topMargin = margin.top;
	if (topMargin === undefined) return 20;

	if (typeof topMargin === "number") {
		return topMargin * (25.4 / 96);
	}

	return parseMarginValue(topMargin);
}

/**
 * Parse a margin value string (e.g., "20mm", "1in", "72pt") to mm.
 */
function parseMarginValue(value: string): number {
	// Try mm
	const mmMatch = value.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
	if (mmMatch?.[1]) {
		return Number.parseFloat(mmMatch[1]);
	}

	// Try inches
	const inMatch = value.match(/^(\d+(?:\.\d+)?)\s*in$/i);
	if (inMatch?.[1]) {
		return Number.parseFloat(inMatch[1]) * 25.4;
	}

	// Try points
	const ptMatch = value.match(/^(\d+(?:\.\d+)?)\s*pt$/i);
	if (ptMatch?.[1]) {
		return Number.parseFloat(ptMatch[1]) * (25.4 / 72);
	}

	// Try cm
	const cmMatch = value.match(/^(\d+(?:\.\d+)?)\s*cm$/i);
	if (cmMatch?.[1]) {
		return Number.parseFloat(cmMatch[1]) * 10;
	}

	// Try px (assume 96 DPI)
	const pxMatch = value.match(/^(\d+(?:\.\d+)?)\s*px$/i);
	if (pxMatch?.[1]) {
		return Number.parseFloat(pxMatch[1]) * (25.4 / 96);
	}

	return 20; // Default fallback
}
