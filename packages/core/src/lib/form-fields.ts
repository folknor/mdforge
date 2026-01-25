import type { MarkedExtension, Tokens } from "marked";

/**
 * Form field types
 */
type FieldType = "text" | "select" | "checklist" | "radiolist" | "textarea";

/**
 * Options for form fields extension.
 */
export interface FormFieldsOptions {
	/**
	 * If true, add data attributes for AcroForm field extraction.
	 * Used by fillable PDF generation to locate fields for post-processing.
	 */
	fillable?: boolean;
}

/**
 * Marked extension for form fields using marked-forms syntax.
 *
 * Syntax:
 * - Text input: `[Label ??](fieldName)` or `[??](fieldName)`
 * - Textarea: `[Label ???](fieldName)` (3 question marks)
 * - Select: `[?select?](fieldName)` followed by a list
 * - Checkboxes: `[?checklist?](fieldName)` followed by a list
 * - Radio: `[?radiolist?](fieldName)` followed by a list
 *
 * Modifiers (append to ??):
 * - `*` = required field
 * - `H` = hidden field
 * - `M` = modern format (wraps list in ul)
 *
 * @see https://github.com/jldec/marked-forms
 */
export function formFields(options: FormFieldsOptions = {}): MarkedExtension {
	const { fillable = false } = options;
	// Track pending list consumers (select, checklist, radiolist)
	let pendingListConsumer: {
		type: FieldType;
		name: string;
		label: string;
	} | null = null;

	return {
		extensions: [
			// Block-level: select, checklist, radiolist declarations
			{
				name: "formFieldBlock",
				level: "block",
				start(src: string): number | undefined {
					const match = src.match(
						/^\[\?(?:select|checklist|radiolist)\?\s*([^\]]*)\]\(([^)]*)\)/m,
					);
					return match?.index;
				},
				tokenizer(src: string): Tokens.Generic | undefined {
					const match =
						/^\[(\?(?:select|checklist|radiolist)\?)\s*([^\]]*)\]\(([^)]*)\)\n?/.exec(
							src,
						);
					if (match) {
						const typeStr = match[1] ?? "";
						const label = match[2]?.trim() ?? "";
						const name = match[3]?.trim() ?? "";

						let type: FieldType = "select";
						if (typeStr.includes("checklist")) type = "checklist";
						else if (typeStr.includes("radiolist")) type = "radiolist";

						pendingListConsumer = {
							type,
							name,
							label,
						};

						return {
							type: "formFieldBlock",
							raw: match[0],
							fieldType: type,
							name,
							label,
						};
					}
					return;
				},
				renderer(): string {
					// Actual rendering happens when we see the list
					return "";
				},
			},

			// Intercept lists that follow form field declarations
			{
				name: "formFieldList",
				level: "block",
				start(src: string): number | undefined {
					if (!pendingListConsumer) return;
					// Check if this starts with a list
					const match = src.match(/^(\s*[-*+]|\s*\d+\.)\s/m);
					return match?.index;
				},
				tokenizer(src: string): Tokens.Generic | undefined {
					if (!pendingListConsumer) return;

					// Match the list using marked's default list pattern
					const listMatch = src.match(
						/^(([ \t]*[-*+][ \t]+.+(?:\n|$))+|([ \t]*\d+\.[ \t]+.+(?:\n|$))+)/,
					);
					if (!listMatch) return;

					const consumer = pendingListConsumer;
					pendingListConsumer = null;

					// Parse list items manually
					const listRaw = listMatch[0];
					const itemMatches = listRaw.matchAll(
						/^[ \t]*[-*+\d.]+[ \t]+(.+?)(?:\n|$)/gm,
					);
					const options: Array<{ text: string; value: string }> = [];

					for (const m of itemMatches) {
						const text = m[1]?.trim() ?? "";
						// Check for quoted value
						const valueMatch = text.match(/^(.+?)\s+"([^"]+)"$/);
						if (valueMatch?.[1] && valueMatch[2]) {
							options.push({
								text: valueMatch[1].trim(),
								value: valueMatch[2],
							});
						} else {
							options.push({ text, value: text });
						}
					}

					return {
						type: "formFieldList",
						raw: listRaw,
						fieldType: consumer.type,
						name: consumer.name,
						label: consumer.label,
						options,
					};
				},
				renderer(token: Tokens.Generic): string {
					const { fieldType, name, label, options } =
						token as unknown as {
							fieldType: FieldType;
							name: string;
							label: string;
							options: Array<{ text: string; value: string }>;
						};

					if (fieldType === "select") {
						if (fillable) {
							// Fillable mode: render as actual select (AcroForm dropdown will work)
							const optionsHtml = options
								.map((o) => `<option value="${o.value}">${o.text}</option>`)
								.join("\n");
							const dataAttrs = `data-form-field data-field-name="${name}" data-field-type="select"`;
							return `<label class="form-field form-select" ${dataAttrs}>
${label ? `<span class="form-label">${label}</span>` : ""}
<select name="${name}">
${optionsHtml}
</select>
</label>\n`;
						}
						// Default mode: render as radio buttons (static dropdowns are useless)
						const itemsHtml = options
							.map(
								(o) => `<label class="form-option">
<input type="radio" name="${name}" value="${o.value}">
<span>${o.text}</span>
</label>`,
							)
							.join("\n");
						return `<fieldset class="form-field form-radiolist form-select-as-radio">
${label ? `<legend class="form-label">${label}</legend>` : ""}
<div class="form-options">
${itemsHtml}
</div>
</fieldset>\n`;
					}

					if (fieldType === "checklist" || fieldType === "radiolist") {
						const inputType = fieldType === "checklist" ? "checkbox" : "radio";
						const itemsHtml = options
							.map(
								(o) => {
									const optionDataAttrs = fillable
										? `data-form-field data-field-name="${name}" data-field-type="${inputType}" data-field-value="${o.value}"`
										: "";
									return `<label class="form-option" ${optionDataAttrs}>
<input type="${inputType}" name="${name}" value="${o.value}">
<span>${o.text}</span>
</label>`;
								},
							)
							.join("\n");

						return `<fieldset class="form-field form-${fieldType}">
${label ? `<legend class="form-label">${label}</legend>` : ""}
<div class="form-options">
${itemsHtml}
</div>
</fieldset>\n`;
					}

					return "";
				},
			},

			// Inline: text input and textarea
			{
				name: "formFieldInline",
				level: "inline",
				start(src: string): number | undefined {
					return src.indexOf("[");
				},
				tokenizer(src: string): Tokens.Generic | undefined {
					// Text input: [Label ??](name) or [??](name)
					// Textarea: [Label ???](name) or [Label ???6](name) for 6 lines
					const match = /^\[([^\]]*?)(\?{2,3})(\d*)\]\(([^)]*)\)/.exec(src);
					if (match) {
						const label = match[1]?.trim() ?? "";
						const questionMarks = match[2] ?? "??";
						const lineCount = match[3] ? Number.parseInt(match[3], 10) : undefined;
						const name =
							match[4]?.trim() ?? label.toLowerCase().replace(/\s+/g, "_");

						const isTextarea = questionMarks === "???";

						return {
							type: "formFieldInline",
							raw: match[0],
							fieldType: isTextarea ? "textarea" : "text",
							name,
							label,
							lineCount,
						};
					}
					return;
				},
				renderer(token: Tokens.Generic): string {
					const { fieldType, name, label, lineCount } = token as unknown as {
						fieldType: FieldType;
						name: string;
						label: string;
						lineCount?: number;
					};

					const dataAttrs = fillable
						? `data-form-field data-field-name="${name}" data-field-type="${fieldType}"`
						: "";

					if (fieldType === "textarea") {
						// Calculate height: default 4 lines, or use lineCount if specified
						// Each line is approximately 1.5em (line-height) + padding
						const lines = lineCount ?? 4;
						const heightStyle = `style="height: ${lines * 1.5}em"`;
						return `<label class="form-field form-textarea" ${dataAttrs}>
${label ? `<span class="form-label">${label}</span>` : ""}
<textarea name="${name}" ${heightStyle}></textarea>
</label>`;
					}

					// Text input
					return `<label class="form-field form-text" ${dataAttrs}>
${label ? `<span class="form-label">${label}</span>` : ""}
<input type="text" name="${name}">
</label>`;
				},
			},
		],
	};
}

/**
 * CSS for form fields - provides both screen and print styles.
 */
export const formFieldsCss = `
/* Form fields base */
.form-field {
  display: block;
  margin: 0.75em 0;
  break-inside: avoid;
}

.form-label {
  display: block;
  font-weight: 500;
  margin-bottom: 0.25em;
}

/* Text inputs and textareas */
.form-text input,
.form-textarea textarea {
  display: block;
  width: 100%;
  padding: 0.5em;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 3px;
  font: inherit;
  box-sizing: border-box;
}

.form-textarea textarea {
  min-height: 4em;
  resize: none;
}

/* Select dropdowns */
.form-select select {
  display: block;
  width: 100%;
  padding: 0.5em;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 3px;
  font: inherit;
  background: white;
}

/* Checkboxes and radio buttons */
.form-checklist,
.form-radiolist {
  border: none;
  padding: 0;
  margin: 0.75em 0;
  break-inside: avoid;
}

.form-checklist legend,
.form-radiolist legend {
  font-weight: 500;
  margin-bottom: 0.5em;
}

.form-options {
  list-style: none;
  padding: 0;
  margin: 0;
}

.form-option {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin: 0.25em 0;
  font-weight: normal;
  cursor: pointer;
}

.form-option input {
  margin: 0;
}

/* Print styles - show as lines/boxes for hand-filling */
@media print {
  .form-text input,
  .form-textarea textarea,
  .form-select select {
    border: none;
    border-bottom: 1px solid black;
    border-radius: 0;
    background: transparent;
    padding: 0.25em 0;
  }

  .form-textarea textarea {
    border: 1px solid black;
  }

  .form-option input[type="checkbox"] {
    appearance: none;
    width: 1em;
    height: 1em;
    border: 1px solid black;
    border-radius: 2px;
  }

  .form-option input[type="radio"] {
    appearance: none;
    width: 1em;
    height: 1em;
    border: 1px solid black;
    border-radius: 50%;
  }
}
`;
