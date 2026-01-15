import type { MarkedExtension } from "marked";

/**
 * Form field types
 */
type FieldType = "text" | "select" | "checklist" | "radiolist" | "textarea";

interface FieldModifiers {
	required: boolean;
	hidden: boolean;
	modern: boolean; // wraps in ul
}

/**
 * Parse modifiers from the field type string (e.g., "??*" or "?select?M")
 */
function parseModifiers(typeStr: string): FieldModifiers {
	return {
		required: typeStr.includes("*"),
		hidden: typeStr.includes("H"),
		modern: typeStr.includes("M"),
	};
}

/**
 * Generate HTML attributes string
 */
function attrs(obj: Record<string, string | boolean | undefined>): string {
	return Object.entries(obj)
		.filter(([, v]) => v !== undefined && v !== false)
		.map(([k, v]) => (v === true ? k : `${k}="${v}"`))
		.join(" ");
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
export function formFields(): MarkedExtension {
	// Track pending list consumers (select, checklist, radiolist)
	let pendingListConsumer: {
		type: FieldType;
		name: string;
		label: string;
		modifiers: FieldModifiers;
	} | null = null;

	return {
		extensions: [
			// Block-level: select, checklist, radiolist declarations
			{
				name: "formFieldBlock",
				level: "block",
				start(src) {
					const match = src.match(
						/^\[(\?(?:select|checklist|radiolist)\?[*HM]*)\s*([^\]]*)\]\(([^)]*)\)/m,
					);
					return match?.index;
				},
				tokenizer(src) {
					const match =
						/^\[(\?(?:select|checklist|radiolist)\?[*HM]*)\s*([^\]]*)\]\(([^)]*)\)\n?/.exec(
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
							modifiers: parseModifiers(typeStr),
						};

						return {
							type: "formFieldBlock",
							raw: match[0],
							fieldType: type,
							name,
							label,
							modifiers: parseModifiers(typeStr),
						};
					}
					return;
				},
				renderer() {
					// Actual rendering happens when we see the list
					return "";
				},
			},

			// Intercept lists that follow form field declarations
			{
				name: "formFieldList",
				level: "block",
				start(src) {
					if (!pendingListConsumer) return;
					// Check if this starts with a list
					const match = src.match(/^(\s*[-*+]|\s*\d+\.)\s/m);
					return match?.index;
				},
				tokenizer(src) {
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
						modifiers: consumer.modifiers,
						options,
					};
				},
				renderer(token) {
					const { fieldType, name, label, modifiers, options } =
						token as unknown as {
							fieldType: FieldType;
							name: string;
							label: string;
							modifiers: FieldModifiers;
							options: Array<{ text: string; value: string }>;
						};

					const required = modifiers.required ? "required" : undefined;

					if (fieldType === "select") {
						const optionsHtml = options
							.map((o) => `<option value="${o.value}">${o.text}</option>`)
							.join("\n");
						return `<label class="form-field form-select">
${label ? `<span class="form-label">${label}</span>` : ""}
<select name="${name}" ${attrs({ required })}>
${optionsHtml}
</select>
</label>\n`;
					}

					if (fieldType === "checklist" || fieldType === "radiolist") {
						const inputType = fieldType === "checklist" ? "checkbox" : "radio";
						const itemsHtml = options
							.map(
								(o, i) => `<label class="form-option">
<input type="${inputType}" name="${name}" value="${o.value}" ${attrs({ required: i === 0 ? required : undefined })}>
<span>${o.text}</span>
</label>`,
							)
							.join("\n");

						const wrapper = modifiers.modern ? "ul" : "div";
						return `<fieldset class="form-field form-${fieldType}">
${label ? `<legend class="form-label">${label}</legend>` : ""}
<${wrapper} class="form-options">
${itemsHtml}
</${wrapper}>
</fieldset>\n`;
					}

					return "";
				},
			},

			// Inline: text input and textarea
			{
				name: "formFieldInline",
				level: "inline",
				start(src) {
					return src.indexOf("[");
				},
				tokenizer(src) {
					// Text input: [Label ??](name) or [??](name)
					// Textarea: [Label ???](name)
					const match = /^\[([^\]]*?)(\?{2,3}[*HM]*)\]\(([^)]*)\)/.exec(src);
					if (match) {
						const label = match[1]?.trim() ?? "";
						const typeStr = match[2] ?? "??";
						const name =
							match[3]?.trim() ?? label.toLowerCase().replace(/\s+/g, "_");

						const isTextarea = typeStr.startsWith("???");
						const modifiers = parseModifiers(typeStr);

						return {
							type: "formFieldInline",
							raw: match[0],
							fieldType: isTextarea ? "textarea" : "text",
							name,
							label,
							modifiers,
						};
					}
					return;
				},
				renderer(token) {
					const { fieldType, name, label, modifiers } = token as unknown as {
						fieldType: FieldType;
						name: string;
						label: string;
						modifiers: FieldModifiers;
					};

					const required = modifiers.required ? "required" : undefined;
					const hidden = modifiers.hidden ? "hidden" : undefined;

					if (fieldType === "textarea") {
						return `<label class="form-field form-textarea">
${label ? `<span class="form-label">${label}</span>` : ""}
<textarea name="${name}" ${attrs({ required, hidden })}></textarea>
</label>`;
					}

					// Text input
					return `<label class="form-field form-text">
${label ? `<span class="form-label">${label}</span>` : ""}
<input type="text" name="${name}" ${attrs({ required, hidden })}>
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
}

.form-textarea textarea {
  min-height: 4em;
  resize: vertical;
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
