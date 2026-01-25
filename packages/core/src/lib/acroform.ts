/**
 * AcroForm field generation for fillable PDFs.
 *
 * This module post-processes Puppeteer-generated PDFs to add real
 * AcroForm fields, making them fillable in PDF readers.
 *
 * The approach uses marker-based positioning:
 * 1. Form fields include invisible link markers in HTML
 * 2. These links become PDF link annotations with exact page + coordinates
 * 3. We read the annotations, add AcroForm fields at those positions
 * 4. Remove the marker annotations
 */

import { PDFArray, PDFDict, PDFDocument, PDFName } from "@folknor/pdf-lib";
import { MARKER_URL_PREFIX } from "./form-fields.js";

/**
 * Position information for a form field extracted from marker annotations.
 */
export interface FieldPosition {
	name: string;
	type: "text" | "textarea" | "select" | "checkbox" | "radio";
	x: number;
	y: number;
	width: number;
	height: number;
	/** Page index (0-based) */
	pageIndex: number;
	/** For select fields: list of options */
	options?: string[];
	/** For checkbox/radio fields: the value attribute */
	value?: string;
}

/**
 * Configuration for AcroForm field generation.
 */
export interface AcroFormConfig {
	/** For select fields: map of field name to list of options */
	selectOptions?: Map<string, string[]>;
}

/**
 * Parse a marker URL to extract field information.
 * URL format: https://mdforge.marker/{name}?type={type}&value={value}
 */
function parseMarkerUrl(url: string): { name: string; type: string; value?: string } | null {
	if (!url.startsWith(MARKER_URL_PREFIX)) return null;

	try {
		const urlObj = new URL(url);
		const name = decodeURIComponent(urlObj.pathname.slice(1)); // Remove leading /
		const type = urlObj.searchParams.get("type");
		const value = urlObj.searchParams.get("value") || undefined;

		if (!name || !type) return null;
		return { name, type, value };
	} catch {
		return null;
	}
}

/**
 * Extract marker annotations from a PDF and convert to field positions.
 * Also removes the marker annotations from the PDF.
 */
function extractAndRemoveMarkers(pdfDoc: PDFDocument): FieldPosition[] {
	const fields: FieldPosition[] = [];
	const pages = pdfDoc.getPages();

	for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
		const page = pages[pageIndex];
		if (!page) continue;

		const annotsRef = page.node.get(PDFName.of("Annots"));
		if (!annotsRef) continue;

		const annots = page.node.context.lookup(annotsRef);
		if (!annots || !(annots instanceof PDFArray)) continue;

		// Collect indices of marker annotations to remove
		const toRemove: number[] = [];

		for (let j = 0; j < annots.size(); j++) {
			const annotRef = annots.get(j);
			const annotObj = page.node.context.lookup(annotRef);
			if (!annotObj || !(annotObj instanceof PDFDict)) continue;
			const annot = annotObj;

			// Check if it's a Link annotation
			const subtype = annot.get(PDFName.of("Subtype"));
			if (subtype?.toString() !== "/Link") continue;

			// Get the action to extract URL
			const actionRef = annot.get(PDFName.of("A"));
			if (!actionRef) continue;

			const actionObj = page.node.context.lookup(actionRef);
			if (!actionObj || !(actionObj instanceof PDFDict)) continue;
			const action = actionObj;

			const uriObj = action.get(PDFName.of("URI"));
			if (!uriObj) continue;

			// Extract URL string (it's in format "(url)")
			const urlRaw = uriObj.toString();
			const url = urlRaw.startsWith("(") && urlRaw.endsWith(")")
				? urlRaw.slice(1, -1)
				: urlRaw;

			// Check if it's a marker URL
			const markerInfo = parseMarkerUrl(url);
			if (!markerInfo) continue;

			// Get the rectangle [llx, lly, urx, ury]
			const rectObj = annot.get(PDFName.of("Rect"));
			if (!rectObj || !(rectObj instanceof PDFArray)) continue;

			const rect = rectObj.asArray().map(n => {
				const num = n.toString();
				return Number.parseFloat(num);
			});

			if (rect.length !== 4) continue;

			const [llx, lly, urx, ury] = rect;
			if (llx === undefined || lly === undefined || urx === undefined || ury === undefined) continue;

			fields.push({
				name: markerInfo.name,
				type: markerInfo.type as FieldPosition["type"],
				x: llx,
				y: lly,
				width: urx - llx,
				height: ury - lly,
				pageIndex,
				value: markerInfo.value,
			});

			toRemove.push(j);
		}

		// Remove marker annotations (in reverse order to preserve indices)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			const idx = toRemove[i];
			if (idx !== undefined) {
				annots.remove(idx);
			}
		}
	}

	return fields;
}

/**
 * Add AcroForm fields to a PDF using marker-based positioning.
 *
 * This function:
 * 1. Reads marker link annotations from the PDF
 * 2. Extracts field positions from the annotation rectangles
 * 3. Adds AcroForm fields at those exact positions
 * 4. Removes the marker annotations
 *
 * @param pdfBuffer - The PDF buffer to modify
 * @param config - Optional configuration (e.g., select options)
 * @returns Modified PDF buffer with AcroForm fields
 */
export async function addAcroFormFields(
	pdfBuffer: Buffer | Uint8Array,
	config: AcroFormConfig = {},
): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.load(pdfBuffer);
	const pages = pdfDoc.getPages();
	if (pages.length === 0) {
		return pdfDoc.save();
	}

	// Extract marker annotations and get field positions
	const fields = extractAndRemoveMarkers(pdfDoc);
	if (fields.length === 0) {
		return pdfDoc.save();
	}

	const form = pdfDoc.getForm();

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
		const page = pages[field.pageIndex];
		if (!page) continue;

		try {
			if (field.type === "text" || field.type === "textarea") {
				const textField = form.createTextField(field.name);
				textField.addToPage(page, {
					x: field.x,
					y: field.y,
					width: field.width,
					height: field.height,
					borderWidth: 0,
					backgroundColor: undefined, // Transparent - show HTML styling through
				});
				if (field.type === "textarea") {
					textField.enableMultiline();
				}
			} else if (field.type === "select") {
				const dropdown = form.createDropdown(field.name);
				const options = config.selectOptions?.get(field.name);
				if (options) {
					dropdown.addOptions(options);
				}
				dropdown.addToPage(page, {
					x: field.x,
					y: field.y,
					width: field.width,
					height: field.height,
					borderWidth: 0,
					backgroundColor: undefined, // Transparent
				});
			} else if (field.type === "checkbox") {
				const size = Math.min(field.width, field.height);
				const checkbox = form.createCheckBox(field.name);
				checkbox.addToPage(page, {
					x: field.x,
					y: field.y,
					width: size,
					height: size,
					borderWidth: 0,
					backgroundColor: undefined, // Transparent
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
				const page = pages[opt.pageIndex];
				if (!page) continue;

				const size = Math.min(opt.width, opt.height);
				radioGroup.addOptionToPage(opt.value || opt.name, page, {
					x: opt.x,
					y: opt.y,
					width: size,
					height: size,
					borderWidth: 0,
					backgroundColor: undefined, // Transparent
				});
			}
		} catch {
			// Radio group creation may fail - skip silently
		}
	}

	// Add checkbox groups (each checkbox needs unique name)
	for (const [name, options] of checkboxGroups) {
		for (const opt of options) {
			const page = pages[opt.pageIndex];
			if (!page) continue;

			try {
				const size = Math.min(opt.width, opt.height);
				const checkbox = form.createCheckBox(`${name}_${opt.value}`);
				checkbox.addToPage(page, {
					x: opt.x,
					y: opt.y,
					width: size,
					height: size,
					borderWidth: 0,
					backgroundColor: undefined, // Transparent
				});
			} catch {
				// Checkbox creation may fail - skip silently
			}
		}
	}

	// Remove background colors from all form field widgets
	// This is needed because some field types (radio buttons) always set a default
	for (const field of form.getFields()) {
		const widgets = field.acroField.getWidgets();
		for (const widget of widgets) {
			const mk = widget.dict.get(PDFName.of("MK"));
			if (mk && mk instanceof PDFDict) {
				mk.delete(PDFName.of("BG"));
			}
		}
	}

	return pdfDoc.save();
}
