import type { MarkedExtension, Tokens } from "marked";
import { escapeHtml } from "./util.ts";

/**
 * Form field types
 */
type FieldType = "text" | "select" | "checklist" | "radiolist" | "textarea";

/** One entry of a select, checklist or radiolist. */
interface FieldOption {
  text: string;
  value: string;
}

/** Token for the list that follows a select/checklist/radiolist declaration. */
interface FormFieldListToken extends Tokens.Generic {
  type: "formFieldList";
  fieldType: FieldType;
  name: string;
  label: string;
  options: FieldOption[];
}

/** Token for an inline text input or textarea. */
interface FormFieldInlineToken extends Tokens.Generic {
  type: "formFieldInline";
  fieldType: FieldType;
  name: string;
  label: string;
  lineCount: number | undefined;
}

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
          const match = src.match(/^\[\?(?:select|checklist|radiolist)\?\s*([^\]]*)\]\(([^)]*)\)/m);

          return match?.index;
        },
        tokenizer(src: string): Tokens.Generic | undefined {
          const match = /^\[(\?(?:select|checklist|radiolist)\?)\s*([^\]]*)\]\(([^)]*)\)\n?/.exec(
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
        tokenizer(src: string): FormFieldListToken | undefined {
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

          const itemMatches = listRaw.matchAll(/^[ \t]*[-*+\d.]+[ \t]+(.+?)(?:\n|$)/gm);

          const parsedOptions: FieldOption[] = [];

          for (const m of itemMatches) {
            const text = m[1]?.trim() ?? "";
            // Check for quoted value
            const valueMatch = text.match(/^(.+?)\s+"([^"]+)"$/);

            if (valueMatch?.[1] && valueMatch[2]) {
              parsedOptions.push({
                text: valueMatch[1].trim(),
                value: valueMatch[2],
              });
            } else {
              parsedOptions.push({ text, value: text });
            }
          }

          return {
            type: "formFieldList",
            raw: listRaw,
            fieldType: consumer.type,
            name: consumer.name,
            label: consumer.label,
            options: parsedOptions,
          };
        },
        renderer(token: Tokens.Generic): string {
          // SAFETY: marked dispatches this renderer only for tokens whose
          // `type` is "formFieldList", and only the tokenizer above creates
          // them, always as a FormFieldListToken.
          const { fieldType, name, label, options: fieldOptions } = token as FormFieldListToken;

          if (fieldType === "select") {
            if (fillable) {
              // Fillable mode: render as actual select (AcroForm dropdown will work)
              const optionsHtml = fieldOptions
                .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.text)}</option>`)
                .join("\n");

              const dataAttrs = `data-form-field data-field-name="${escapeHtml(name)}" data-field-type="select"`;
              const selectHtml = `<select name="${escapeHtml(name)}">\n${optionsHtml}\n</select>`;
              const wrappedSelect = wrapWithMarker(selectHtml, name, "select", { label });

              return `<label class="form-field form-select" ${dataAttrs}>
${label ? `<span class="form-label">${escapeHtml(label)}</span>` : ""}
${wrappedSelect}
</label>\n`;
            }

            // Default mode: render as radio buttons (static dropdowns are useless)
            const itemsHtml = fieldOptions
              .map(
                (o) => `<label class="form-option">
<input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(o.value)}">
<span>${escapeHtml(o.text)}</span>
</label>`,
              )
              .join("\n");

            return `<fieldset class="form-field form-radiolist form-select-as-radio">
${label ? `<legend class="form-label">${escapeHtml(label)}</legend>` : ""}
<div class="form-options">
${itemsHtml}
</div>
</fieldset>\n`;
          }

          if (fieldType === "checklist" || fieldType === "radiolist") {
            const inputType = fieldType === "checklist" ? "checkbox" : "radio";

            const itemsHtml = fieldOptions
              .map((o) => {
                const optionDataAttrs = fillable
                  ? `data-form-field data-field-name="${escapeHtml(name)}" data-field-type="${escapeHtml(inputType)}" data-field-value="${escapeHtml(o.value)}"`
                  : "";

                const inputHtml = `<input type="${escapeHtml(inputType)}" name="${escapeHtml(name)}" value="${escapeHtml(o.value)}">`;

                const wrappedInput = fillable
                  ? wrapWithMarker(inputHtml, name, inputType, {
                      value: o.value,
                      label,
                      option: o.text,
                    })
                  : inputHtml;

                return `<label class="form-option" ${optionDataAttrs}>
${wrappedInput}
<span>${escapeHtml(o.text)}</span>
</label>`;
              })
              .join("\n");

            return `<fieldset class="form-field form-${escapeHtml(fieldType)}">
${label ? `<legend class="form-label">${escapeHtml(label)}</legend>` : ""}
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
        tokenizer(src: string): FormFieldInlineToken | undefined {
          // Text input: [Label ??](name) or [??](name)
          // Textarea: [Label ???](name) or [Label ???6](name) for 6 lines
          const match = /^\[([^\]]*?)(\?{2,3})(\d*)\]\(([^)]*)\)/.exec(src);

          if (match) {
            const label = match[1]?.trim() ?? "";
            const questionMarks = match[2] ?? "??";

            const lineCount = match[3] ? Number.parseInt(match[3], 10) : undefined;

            const name = match[4]?.trim() ?? label.toLowerCase().replace(/\s+/g, "_");

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
          // SAFETY: marked dispatches this renderer only for tokens whose
          // `type` is "formFieldInline", and only the tokenizer above creates
          // them, always as a FormFieldInlineToken.
          const { fieldType, name, label, lineCount } = token as FormFieldInlineToken;

          const dataAttrs = fillable
            ? `data-form-field data-field-name="${escapeHtml(name)}" data-field-type="${escapeHtml(fieldType)}"`
            : "";

          if (fieldType === "textarea") {
            // Calculate height: default 4 lines, or use lineCount if specified
            // Each line is approximately 1.5em (line-height) + padding
            const lines = lineCount ?? 4;
            const heightStyle = `style="${escapeHtml(`height: ${lines * 1.5}em`)}"`;
            const textareaHtml = `<textarea name="${escapeHtml(name)}" ${heightStyle}></textarea>`;

            const wrappedTextarea = fillable
              ? wrapWithMarker(textareaHtml, name, "textarea", { label })
              : textareaHtml;

            return `<label class="form-field form-textarea" ${dataAttrs}>
${label ? `<span class="form-label">${escapeHtml(label)}</span>` : ""}
${wrappedTextarea}
</label>`;
          }

          // Text input
          const inputHtml = `<input type="text" name="${escapeHtml(name)}">`;

          const wrappedInput = fillable
            ? wrapWithMarker(inputHtml, name, "text", { label })
            : inputHtml;

          return `<label class="form-field form-text" ${dataAttrs}>
${label ? `<span class="form-label">${escapeHtml(label)}</span>` : ""}
${wrappedInput}
</label>`;
        },
      },
    ],
  };
}

/**
 * Marker URL prefix used to identify form field markers in PDF link annotations.
 * The URL format is: https://mdforge.marker/{name}?type={type}&value={value}
 */
export const MARKER_URL_PREFIX = "https://mdforge.marker/";

/**
 * Generate a marker wrapper for fillable mode.
 * The marker link overlays the input element to capture its full dimensions
 * as a PDF link annotation rectangle. The URL also carries what describes the
 * field to assistive technology in the PDF: its label (a group's legend for
 * an option) and an option's visible text.
 */
function wrapWithMarker(
  inputHtml: string,
  name: string,
  type: string,
  describe: { value?: string; label?: string; option?: string } = {},
): string {
  const params = new URLSearchParams({ type });

  if (describe.value) params.set("value", describe.value);

  if (describe.label) params.set("label", describe.label);

  if (describe.option) params.set("option", describe.option);
  const markerUrl = `${MARKER_URL_PREFIX}${encodeURIComponent(name)}?${params}`;

  return `<span class="form-input-wrapper">
<a href="${escapeHtml(markerUrl)}" class="form-marker"></a>
${inputHtml}
</span>`;
}

/**
 * CSS for form fields - provides both screen and print styles.
 */
export const formFieldsCss = `
/* Form input wrapper - contains the marker overlay and the actual input */
.form-input-wrapper {
  position: relative;
  display: block;
}

/* Form field marker - invisible link that overlays the input */
.form-marker {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}

/* Inset marker for inputs/textareas to account for border and padding */
.form-text .form-marker,
.form-textarea .form-marker,
.form-select .form-marker {
  top: 1px;
  left: calc(0.5em + 1px);
  width: calc(100% - 0.5em - 2px);
  height: calc(100% - 2px);
}

/* For checkbox/radio, the wrapper is inline */
.form-option .form-input-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  vertical-align: middle;
}

/* Make checkbox/radio inputs fill the wrapper */
.form-option .form-input-wrapper input[type="checkbox"],
.form-option .form-input-wrapper input[type="radio"] {
  width: 100%;
  height: 100%;
  margin: 0;
}

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

/* In fillable mode, hide the HTML select text so AcroForm shows through empty */
.form-select[data-form-field] select {
  color: transparent;
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
