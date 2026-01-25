#!/usr/bin/env node

/**
 * Investigation script: Can we post-process Puppeteer PDFs to add real AcroForm fields?
 *
 * Approach:
 * 1. Generate a PDF with Puppeteer containing form elements with special markers
 * 2. Parse the PDF with pdf-lib
 * 3. Try to detect marker positions or extract text/annotations
 * 4. Add real AcroForm fields at those positions
 *
 * Run from repo root: node scripts/investigate-form-postprocessing.js
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Import from workspace packages
const puppeteer = require("../packages/core/node_modules/puppeteer");
const { PDFDocument, rgb } = require("../packages/core/node_modules/pdf-lib");

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const outputDir = join(__dirname, "..", "tmp");

// Version tracking for output files
const VERSION = 4; // Increment this when making changes
const versionedName = (base) => `${base}-v${VERSION}`;

// Ensure output directory exists
await fs.mkdir(outputDir, { recursive: true });

/**
 * Step 1: Generate a test PDF with Puppeteer
 * We'll add invisible markers (data attributes, special characters, or colored dots)
 * to help locate form fields later.
 */
async function generateTestPdf() {
	console.log("\n=== Step 1: Generate test PDF with Puppeteer ===\n");

	const html = `
<!DOCTYPE html>
<html>
<head>
	<style>
		body { font-family: sans-serif; padding: 40px; }
		.form-field { margin: 20px 0; }
		.form-field label { display: block; margin-bottom: 5px; }
		.form-field input {
			width: 300px;
			height: 24px;
			border: 1px solid #ccc;
			padding: 4px;
			box-sizing: border-box;
		}
		/* Marker approach 1: Colored corner dots */
		.field-marker {
			position: relative;
		}
		.field-marker::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 4px;
			height: 4px;
			background: #ff0000;
		}
		.field-marker::after {
			content: '';
			position: absolute;
			bottom: 0;
			right: 0;
			width: 4px;
			height: 4px;
			background: #00ff00;
		}
		/* Marker approach 2: Data encoded in near-invisible text */
		.field-id {
			font-size: 1px;
			color: rgba(0,0,0,0.01);
			position: absolute;
			left: -9999px;
		}
	</style>
</head>
<body>
	<h1>Form Field Position Test</h1>

	<div class="form-field">
		<label>Name:</label>
		<span class="field-id">FIELD:name:text</span>
		<div class="field-marker" data-field-name="name" data-field-type="text">
			<input type="text" name="name" placeholder="Enter your name">
		</div>
	</div>

	<div class="form-field">
		<label>Email:</label>
		<span class="field-id">FIELD:email:text</span>
		<div class="field-marker" data-field-name="email" data-field-type="text">
			<input type="text" name="email" placeholder="Enter your email">
		</div>
	</div>

	<div class="form-field">
		<label>Comments:</label>
		<span class="field-id">FIELD:comments:textarea</span>
		<div class="field-marker" data-field-name="comments" data-field-type="textarea">
			<textarea name="comments" style="width: 300px; height: 80px; border: 1px solid #ccc;"></textarea>
		</div>
	</div>
</body>
</html>
`;

	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setContent(html, { waitUntil: "networkidle0" });

	// Get field positions from the DOM before generating PDF
	const fieldPositions = await page.evaluate(() => {
		const markers = document.querySelectorAll(".field-marker");
		return Array.from(markers).map((marker) => {
			const rect = marker.getBoundingClientRect();
			const input = marker.querySelector("input, textarea");
			const inputRect = input?.getBoundingClientRect();
			return {
				name: marker.dataset.fieldName,
				type: marker.dataset.fieldType,
				marker: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				input: inputRect
					? { x: inputRect.x, y: inputRect.y, width: inputRect.width, height: inputRect.height }
					: null,
			};
		});
	});

	console.log("Field positions from DOM:");
	console.log(JSON.stringify(fieldPositions, null, 2));

	// Save positions to JSON for later use
	const positionsFile = join(outputDir, "field-positions.json");
	await fs.writeFile(positionsFile, JSON.stringify(fieldPositions, null, 2));
	console.log(`\nSaved positions to: ${positionsFile}`);

	// Generate PDF
	const pdfPath = join(outputDir, "test-form.pdf");
	await page.pdf({
		path: pdfPath,
		format: "A4",
		printBackground: true,
		margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
	});

	console.log(`Generated PDF: ${pdfPath}`);

	// Also get page dimensions for coordinate mapping
	const pageInfo = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	}));
	console.log(`Page dimensions: ${pageInfo.width}x${pageInfo.height}`);

	await browser.close();

	return { pdfPath, fieldPositions, pageInfo };
}

/**
 * Step 2: Parse the PDF and explore what we can detect
 */
async function analyzePdf(pdfPath) {
	console.log("\n=== Step 2: Analyze PDF with pdf-lib ===\n");

	const pdfBytes = await fs.readFile(pdfPath);
	const pdfDoc = await PDFDocument.load(pdfBytes);

	const pages = pdfDoc.getPages();
	console.log(`Number of pages: ${pages.length}`);

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		const { width, height } = page.getSize();
		console.log(`Page ${i + 1} dimensions: ${width} x ${height} points`);
		console.log(`  (1 point = 1/72 inch, A4 ≈ 595 x 842 points)`);
	}

	// Check for any existing annotations
	const form = pdfDoc.getForm();
	const fields = form.getFields();
	console.log(`\nExisting form fields: ${fields.length}`);

	// Try to access raw PDF structure
	console.log("\nExploring PDF structure...");
	const catalog = pdfDoc.catalog;
	console.log(`Catalog keys: ${Object.keys(catalog).join(", ")}`);

	return { pdfDoc, pages };
}

/**
 * Step 3: Add AcroForm fields at calculated positions
 */
async function addFormFields(pdfDoc, pages, fieldPositions, pageInfo) {
	console.log("\n=== Step 3: Add AcroForm fields ===\n");

	const page = pages[0];
	const { width: pdfWidth, height: pdfHeight } = page.getSize();

	// PDF coordinate system: origin at bottom-left
	// HTML coordinate system: origin at top-left
	// We need to map HTML coordinates to PDF coordinates

	// Puppeteer PDF margins (20mm = ~56.7 points)
	const marginPt = 20 * (72 / 25.4); // mm to points

	// Calculate scale factors
	// The content area in the PDF is (pdfWidth - 2*margin) x (pdfHeight - 2*margin)
	const contentWidth = pdfWidth - 2 * marginPt;
	const contentHeight = pdfHeight - 2 * marginPt;

	// HTML to PDF scale (approximate - Puppeteer uses 96 DPI, PDF uses 72 DPI)
	const scale = 72 / 96;

	console.log(`PDF dimensions: ${pdfWidth} x ${pdfHeight} points`);
	console.log(`Content area: ${contentWidth} x ${contentHeight} points`);
	console.log(`HTML to PDF scale: ${scale}`);
	console.log(`Margin: ${marginPt} points`);

	const form = pdfDoc.getForm();

	for (const field of fieldPositions) {
		if (!field.input) continue;

		// Convert HTML coordinates to PDF coordinates
		const htmlX = field.input.x;
		const htmlY = field.input.y;
		const htmlWidth = field.input.width;
		const htmlHeight = field.input.height;

		// Scale and translate
		const pdfX = marginPt + htmlX * scale;
		// Flip Y axis: PDF origin is bottom-left
		const pdfY = pdfHeight - marginPt - (htmlY + htmlHeight) * scale;
		const pdfFieldWidth = htmlWidth * scale;
		const pdfFieldHeight = htmlHeight * scale;

		console.log(`\nField: ${field.name}`);
		console.log(`  HTML: x=${htmlX}, y=${htmlY}, w=${htmlWidth}, h=${htmlHeight}`);
		console.log(`  PDF:  x=${pdfX.toFixed(1)}, y=${pdfY.toFixed(1)}, w=${pdfFieldWidth.toFixed(1)}, h=${pdfFieldHeight.toFixed(1)}`);

		try {
			const textField = form.createTextField(field.name);
			textField.addToPage(page, {
				x: pdfX,
				y: pdfY,
				width: pdfFieldWidth,
				height: pdfFieldHeight,
				borderColor: rgb(0, 0, 1),
				borderWidth: 1,
			});
			textField.setFontSize(10);
			console.log(`  ✓ Added text field`);
		} catch (err) {
			console.log(`  ✗ Error: ${err.message}`);
		}
	}

	// Save the modified PDF
	const outputPath = join(outputDir, "test-form-with-fields.pdf");
	const modifiedPdfBytes = await pdfDoc.save();
	await fs.writeFile(outputPath, modifiedPdfBytes);
	console.log(`\nSaved modified PDF: ${outputPath}`);

	return outputPath;
}

/**
 * Step 4: Embed field positions in PDF metadata
 * This eliminates the need for a separate JSON file
 */
async function embedPositionsInPdf(pdfPath, fieldPositions, pageInfo) {
	console.log("\n=== Step 4: Embed positions in PDF metadata ===\n");

	const pdfBytes = await fs.readFile(pdfPath);
	const pdfDoc = await PDFDocument.load(pdfBytes);

	// Create metadata object
	const formMetadata = {
		version: 1,
		pageInfo,
		fields: fieldPositions,
	};

	// Embed as custom metadata using PDF keywords (hacky but works)
	// Better approach would be XMP metadata but pdf-lib has limited support
	const existingKeywords = pdfDoc.getKeywords() || [];
	const metadataMarker = `__MDFORGE_FORM_FIELDS__${JSON.stringify(formMetadata)}__END_MDFORGE__`;

	pdfDoc.setKeywords([...existingKeywords, metadataMarker]);
	pdfDoc.setSubject("PDF with embedded form field positions for post-processing");

	const outputPath = join(outputDir, "test-form-with-metadata.pdf");
	const modifiedBytes = await pdfDoc.save();
	await fs.writeFile(outputPath, modifiedBytes);

	console.log(`Embedded metadata in: ${outputPath}`);
	console.log(`Metadata size: ${metadataMarker.length} bytes`);

	// Verify we can read it back
	const reloadedPdf = await PDFDocument.load(modifiedBytes);
	const keywords = reloadedPdf.getKeywords();
	console.log(`Keywords type: ${typeof keywords}, value: ${JSON.stringify(keywords)?.slice(0, 100)}`);

	// Keywords might be a string or array depending on pdf-lib version
	const keywordStr = Array.isArray(keywords) ? keywords.join(" ") : (keywords || "");
	const match = keywordStr.match(/__MDFORGE_FORM_FIELDS__(.+?)__END_MDFORGE__/);
	if (match) {
		const extracted = JSON.parse(match[1]);
		console.log(`Successfully extracted ${extracted.fields.length} field definitions from PDF metadata`);
	} else {
		console.log("✗ Failed to extract metadata (might be in a different format)");
	}

	return outputPath;
}

/**
 * Step 5: Full pipeline - generate, embed metadata, add form fields
 */
async function fullPipeline() {
	console.log("\n=== Step 5: Full pipeline test ===\n");

	const html = `
<!DOCTYPE html>
<html>
<head>
	<style>
		body { font-family: Georgia, serif; padding: 20px; line-height: 1.3; font-size: 11px; }
		h1 { color: #333; margin: 0 0 8px 0; font-size: 16px; }
		h2 { color: #555; font-size: 12px; margin: 10px 0 4px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
		.form-field { margin: 6px 0; }
		.form-label { display: block; font-weight: bold; margin-bottom: 2px; }
		input[type="text"], input[type="email"] {
			width: 250px;
			padding: 4px;
			border: 1px solid #999;
			font-size: 10px;
			box-sizing: border-box;
		}
		textarea {
			width: 350px;
			height: 40px;
			padding: 4px;
			border: 1px solid #999;
			font-size: 10px;
			box-sizing: border-box;
		}
		select {
			padding: 4px;
			font-size: 10px;
			border: 1px solid #999;
			min-width: 150px;
		}
		.radio-group, .checkbox-group { margin: 2px 0; }
		.radio-group label, .checkbox-group label {
			display: block;
			font-weight: normal;
			margin: 2px 0;
		}
		.radio-group input, .checkbox-group input {
			margin-right: 6px;
			width: 13px;
			height: 13px;
			vertical-align: middle;
		}
		.inline-checkbox {
			display: flex;
			align-items: center;
			margin: 3px 0;
		}
		.inline-checkbox input { margin-right: 6px; width: 13px; height: 13px; }
		.inline-checkbox label { font-weight: normal; }
	</style>
</head>
<body>
	<h1>Event Registration - All Field Types</h1>

	<h2>Text Inputs</h2>
	<div class="form-field" data-field="firstName" data-type="text">
		<span class="form-label">First Name</span>
		<input type="text" name="firstName">
	</div>
	<div class="form-field" data-field="lastName" data-type="text">
		<span class="form-label">Last Name</span>
		<input type="text" name="lastName">
	</div>
	<div class="form-field" data-field="email" data-type="text">
		<span class="form-label">Email</span>
		<input type="email" name="email">
	</div>

	<h2>Dropdowns</h2>
	<div class="form-field" data-field="country" data-type="select" data-options="USA,Canada,UK,Other">
		<span class="form-label">Country</span>
		<select name="country">
			<option>USA</option>
			<option>Canada</option>
			<option>UK</option>
			<option>Other</option>
		</select>
	</div>

	<h2>Radio Buttons</h2>
	<div class="form-field" data-field="ticket" data-type="radio" data-options="General,VIP,Virtual">
		<span class="form-label">Ticket Type</span>
		<div class="radio-group">
			<label><input type="radio" name="ticket" value="general"> General - $99</label>
			<label><input type="radio" name="ticket" value="vip"> VIP - $199</label>
			<label><input type="radio" name="ticket" value="virtual"> Virtual - $49</label>
		</div>
	</div>

	<h2>Checkbox Group</h2>
	<div class="form-field" data-field="sessions" data-type="checkboxgroup" data-options="Keynotes,Workshops,Networking">
		<span class="form-label">Sessions of Interest</span>
		<div class="checkbox-group">
			<label><input type="checkbox" name="sessions" value="keynotes"> Keynotes</label>
			<label><input type="checkbox" name="sessions" value="workshops"> Workshops</label>
			<label><input type="checkbox" name="sessions" value="networking"> Networking</label>
		</div>
	</div>

	<h2>Single Checkboxes</h2>
	<div class="form-field inline-checkbox" data-field="newsletter" data-type="checkbox">
		<input type="checkbox" name="newsletter" id="newsletter">
		<label for="newsletter">Subscribe to newsletter</label>
	</div>
	<div class="form-field inline-checkbox" data-field="terms" data-type="checkbox">
		<input type="checkbox" name="terms" id="terms">
		<label for="terms">I agree to terms and conditions</label>
	</div>

	<h2>Textarea</h2>
	<div class="form-field" data-field="comments" data-type="textarea">
		<span class="form-label">Comments</span>
		<textarea name="comments"></textarea>
	</div>
</body>
</html>
`;

	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setContent(html, { waitUntil: "networkidle0" });

	// Extract field positions
	const fieldPositions = await page.evaluate(() => {
		const fields = document.querySelectorAll("[data-field]");
		return Array.from(fields).map((field) => {
			const type = field.dataset.type;
			const options = field.dataset.options?.split(",") || [];

			// For radio/checkbox groups, get positions of each option
			if (type === "radio" || type === "checkboxgroup") {
				const inputs = field.querySelectorAll("input");
				const optionPositions = Array.from(inputs).map((input, i) => {
					const rect = input.getBoundingClientRect();
					return {
						value: input.value,
						label: options[i] || input.value,
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
					};
				});
				// Get bounding box of the whole group
				const groupRect = field.getBoundingClientRect();
				return {
					name: field.dataset.field,
					type,
					options: optionPositions,
					x: groupRect.x,
					y: groupRect.y,
					width: groupRect.width,
					height: groupRect.height,
				};
			}

			// For single inputs
			const input = field.querySelector("input, textarea, select");
			if (!input) return null;
			const rect = input.getBoundingClientRect();
			return {
				name: field.dataset.field,
				type,
				options,
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
			};
		}).filter(Boolean);
	});

	const pageInfo = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	}));

	// Generate PDF
	const pdfBuffer = await page.pdf({
		format: "A4",
		printBackground: true,
		margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
	});

	await browser.close();

	// Load PDF and add form fields
	const pdfDoc = await PDFDocument.load(pdfBuffer);
	const pages = pdfDoc.getPages();
	const firstPage = pages[0];
	const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();
	const form = pdfDoc.getForm();

	const marginPt = 20 * (72 / 25.4);
	const scale = 72 / 96;

	console.log("Adding form fields:");
	for (const field of fieldPositions) {
		console.log(`\n  ${field.name} (${field.type}):`);

		try {
			if (field.type === "text" || field.type === "textarea") {
				const pdfX = marginPt + field.x * scale;
				const pdfY = pdfHeight - marginPt - (field.y + field.height) * scale;
				const pdfW = field.width * scale;
				const pdfH = field.height * scale;

				console.log(`    Position: [${pdfX.toFixed(0)}, ${pdfY.toFixed(0)}, ${pdfW.toFixed(0)}x${pdfH.toFixed(0)}]`);

				const textField = form.createTextField(field.name);
				textField.addToPage(firstPage, {
					x: pdfX,
					y: pdfY,
					width: pdfW,
					height: pdfH,
					borderColor: rgb(0.4, 0.4, 0.4),
					backgroundColor: rgb(1, 1, 0.95),
					borderWidth: 0,
				});
				if (field.type === "textarea") {
					textField.enableMultiline();
				}
				console.log(`    ✓ Added ${field.type} field`);

			} else if (field.type === "checkbox") {
				const pdfX = marginPt + field.x * scale;
				const pdfY = pdfHeight - marginPt - (field.y + field.height) * scale;
				const size = Math.min(field.width, field.height) * scale;

				console.log(`    Position: [${pdfX.toFixed(0)}, ${pdfY.toFixed(0)}, ${size.toFixed(0)}x${size.toFixed(0)}]`);

				const checkbox = form.createCheckBox(field.name);
				checkbox.addToPage(firstPage, {
					x: pdfX,
					y: pdfY,
					width: size,
					height: size,
					borderColor: rgb(0.4, 0.4, 0.4),
					borderWidth: 1,
				});
				console.log(`    ✓ Added checkbox`);

			} else if (field.type === "select") {
				const pdfX = marginPt + field.x * scale;
				const pdfY = pdfHeight - marginPt - (field.y + field.height) * scale;
				const pdfW = field.width * scale;
				const pdfH = field.height * scale;

				console.log(`    Position: [${pdfX.toFixed(0)}, ${pdfY.toFixed(0)}, ${pdfW.toFixed(0)}x${pdfH.toFixed(0)}]`);
				console.log(`    Options: ${field.options.join(", ")}`);

				const dropdown = form.createDropdown(field.name);
				dropdown.addOptions(field.options.length > 0 ? field.options : ["Option 1", "Option 2"]);
				dropdown.addToPage(firstPage, {
					x: pdfX,
					y: pdfY,
					width: pdfW,
					height: pdfH,
					borderColor: rgb(0.4, 0.4, 0.4),
					borderWidth: 1,
				});
				console.log(`    ✓ Added dropdown with ${field.options.length} options`);

			} else if (field.type === "radio") {
				// Radio button group - each option is a separate radio button
				console.log(`    Options: ${field.options.length} radio buttons`);

				const radioGroup = form.createRadioGroup(field.name);

				for (const opt of field.options) {
					const pdfX = marginPt + opt.x * scale;
					const pdfY = pdfHeight - marginPt - (opt.y + opt.height) * scale;
					const size = Math.min(opt.width, opt.height) * scale;

					console.log(`      - ${opt.value}: [${pdfX.toFixed(0)}, ${pdfY.toFixed(0)}, ${size.toFixed(0)}x${size.toFixed(0)}]`);

					radioGroup.addOptionToPage(opt.value, firstPage, {
						x: pdfX,
						y: pdfY,
						width: size,
						height: size,
						borderColor: rgb(0.4, 0.4, 0.4),
						borderWidth: 1,
					});
				}
				console.log(`    ✓ Added radio group with ${field.options.length} options`);

			} else if (field.type === "checkboxgroup") {
				// Checkbox group - each option is a separate checkbox
				console.log(`    Options: ${field.options.length} checkboxes`);

				for (const opt of field.options) {
					const pdfX = marginPt + opt.x * scale;
					const pdfY = pdfHeight - marginPt - (opt.y + opt.height) * scale;
					const size = Math.min(opt.width, opt.height) * scale;

					console.log(`      - ${opt.value}: [${pdfX.toFixed(0)}, ${pdfY.toFixed(0)}, ${size.toFixed(0)}x${size.toFixed(0)}]`);

					// Each checkbox in a group needs a unique name
					const checkbox = form.createCheckBox(`${field.name}_${opt.value}`);
					checkbox.addToPage(firstPage, {
						x: pdfX,
						y: pdfY,
						width: size,
						height: size,
						borderColor: rgb(0.4, 0.4, 0.4),
						borderWidth: 1,
					});
				}
				console.log(`    ✓ Added checkbox group with ${field.options.length} checkboxes`);
			}
		} catch (err) {
			console.log(`    ✗ Error: ${err.message}`);
		}
	}

	// Save final PDF
	const outputPath = join(outputDir, `${versionedName("registration-form-fillable")}.pdf`);
	await fs.writeFile(outputPath, await pdfDoc.save());
	console.log(`\nGenerated fillable PDF: ${outputPath}`);

	return outputPath;
}

/**
 * Summary of findings
 */
function printSummary() {
	console.log("\n" + "=".repeat(60));
	console.log("SUMMARY: Form Post-Processing Feasibility");
	console.log("=".repeat(60));
	console.log(`
✓ FEASIBLE: Post-processing Puppeteer PDFs with pdf-lib works!

APPROACH:
1. Before Puppeteer generates PDF, capture form field positions from DOM
2. Generate PDF with Puppeteer (fields render as static HTML)
3. Load PDF with pdf-lib
4. Add AcroForm fields at calculated positions
5. Save modified PDF

COORDINATE MAPPING:
- HTML uses 96 DPI, PDF uses 72 DPI → scale factor 0.75
- HTML origin: top-left; PDF origin: bottom-left → flip Y axis
- Account for PDF margins (Puppeteer margin option)

FIELD TYPES SUPPORTED:
- Text fields (single line)
- Text areas (multiline)
- Checkboxes
- Dropdowns/Select
- Radio buttons (via createRadioGroup)

INTEGRATION OPTIONS:
1. Add --fillable flag to CLI
2. Modify form-fields extension to track positions
3. Post-process in convert.ts after Puppeteer generates PDF

LIMITATIONS:
- Select options need to be known (can't extract from rendered PDF)
- Alignment depends on accurate coordinate mapping
- Complex layouts may need adjustment

NEXT STEPS:
- Integrate into mdforge form-fields extension
- Test with real form-fields syntax
- Handle edge cases (multi-page, nested elements)
`);
}

// Run the investigation
async function main() {
	console.log("=".repeat(60));
	console.log("PDF Form Post-Processing Investigation");
	console.log("=".repeat(60));

	try {
		const { pdfPath, fieldPositions, pageInfo } = await generateTestPdf();
		const { pdfDoc, pages } = await analyzePdf(pdfPath);
		await addFormFields(pdfDoc, pages, fieldPositions, pageInfo);
		await embedPositionsInPdf(pdfPath, fieldPositions, pageInfo);
		await fullPipeline();
		printSummary();

		console.log("\nGenerated files in tmp/:");
		const files = await fs.readdir(outputDir);
		for (const file of files) {
			const stat = await fs.stat(join(outputDir, file));
			console.log(`  ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
		}
	} catch (error) {
		console.error("Error:", error);
		process.exit(1);
	}
}

main();
