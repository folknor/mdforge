/**
 * What fillable PDF fields are built from: each select's options, and each
 * text, textarea and select field's content box, font size and font files that can
 * reproduce its font. They are read from the live page after printing, so
 * styles that depend on the print layout (rather than the media type, which
 * is the same) are not supported.
 *
 * A field's font is resolved the way the browser resolves its font-family
 * stack: family by family, in order, taking the system's file for each
 * (fontconfig). acroform.ts takes the first candidate that embeds and covers
 * the field's characters, else Helvetica.
 *
 * Limits: web fonts (the Google faces core downloads, @font-face files) are
 * never used, because the PDF library cannot embed WOFF/WOFF2 correctly
 * through the fontkit it is given (acroform.ts); such a family falls to the
 * next family in its stack. A variable font is embedded at its default
 * instance, whatever weight was asked for; font collections (.ttc) are not
 * used.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { AcroFormConfig, FieldStyle, FontData } from "@mdforge/pdf";

/** One field as the browser styled it. */
export interface PageFieldStyle {
  name: string;
  /** The computed font-family stack, unquoted, in order. */
  families: string[];
  fontSizePx: number;
  textInsetsPx?: FieldStyle["textInsetsPx"];
  weight: number;
  style: string;
}

/**
 * Browser-side: add the page-scale marker acroform.ts measures the printed
 * points per CSS px with (SCALE_MARKER_URL). Its box is pinned with
 * !important so document CSS for links cannot resize it; an ancestor
 * transform or zoom is not supported.
 */
export function addScaleMarker(marker: { url: string; px: number }): void {
  const link = document.createElement("a");
  link.href = marker.url;
  link.setAttribute("aria-hidden", "true");
  link.tabIndex = -1;

  const box = {
    position: "fixed",
    top: "0",
    left: "0",
    width: `${marker.px}px`,
    height: `${marker.px}px`,
    margin: "0",
    padding: "0",
    border: "0",
    "box-sizing": "content-box",
    display: "block",
    visibility: "visible",
    transform: "none",
    zoom: "1",
    "pointer-events": "none",
  } satisfies Record<string, string>;

  for (const [property, value] of Object.entries(box)) {
    link.style.setProperty(property, value, "important");
  }

  document.body.append(link);
}

/**
 * Browser-side: hide each form control from the printed PDF's tagged
 * structure. In a fillable PDF the AcroForm widget laid over a control is the
 * control; Chromium would otherwise tag the printed control too (text inputs
 * as a non-interactive PrintField /Form), giving every field a second, dead
 * control. Only the control is hidden: its label and its marker stay in the
 * structure, and the marker's element becomes the widget's (acroform.ts).
 * aria-hidden changes nothing about layout, unless document CSS styles on it,
 * which is not supported. HTML output is never printed, so keeps its controls.
 */
export function hidePrintedControls(): void {
  for (const control of document.querySelectorAll(
    "[data-form-field] input, [data-form-field] textarea, [data-form-field] select",
  )) {
    control.setAttribute("aria-hidden", "true");
  }
}

/** The page's form data that fillable fields are built from. */
export interface PageFields {
  selects: Array<{ name: string; options: string[] }>;
  fields: PageFieldStyle[];
}

/** Browser-side: the select options and text field styles of the page's form fields. */
export function readPageFields(): PageFields {
  const selects: PageFields["selects"] = [];
  const fields: PageFieldStyle[] = [];

  for (const field of document.querySelectorAll(
    "[data-form-field][data-field-type='text'], [data-form-field][data-field-type='textarea'], [data-form-field][data-field-type='select']",
  )) {
    const name = field.getAttribute("data-field-name");
    const control = field.querySelector("input, textarea, select");

    if (!(name && control)) continue;

    if (control instanceof HTMLSelectElement) {
      selects.push({ name, options: Array.from(control.options).map((o) => o.value || o.text) });
    }

    const style = window.getComputedStyle(control);
    const marker = field.querySelector(".form-marker");
    const box = control.getBoundingClientRect();
    const anchor = marker?.getBoundingClientRect();

    // Measure the content box, including asymmetric borders/padding and any
    // wrapper/control offset. Read beside the font in this one evaluation.
    // Untransformed boxes only: bounding rects include transforms, computed
    // padding and borders do not.
    const textInsetsPx = anchor && {
      left:
        box.left - anchor.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      top: box.top - anchor.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      right:
        anchor.right -
        box.right +
        parseFloat(style.borderRightWidth) +
        parseFloat(style.paddingRight),
      bottom:
        anchor.bottom -
        box.bottom +
        parseFloat(style.borderBottomWidth) +
        parseFloat(style.paddingBottom),
    };

    fields.push({
      name,
      // Computed values quote names that need it; a family name containing
      // a comma is not supported.
      families: style.fontFamily
        .split(",")
        .map((family) => family.trim().replace(/^["']|["']$/g, ""))
        .filter((family) => family !== ""),
      fontSizePx: parseFloat(style.fontSize),
      textInsetsPx,
      weight: parseFloat(style.fontWeight) || 400,
      style: style.fontStyle.startsWith("oblique") ? "oblique" : style.fontStyle,
    });
  }

  return { selects, fields };
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

const run = promisify(execFile);

/** fontconfig's weight for a CSS weight (fontconfig.h FC_WEIGHT_*). */
function fcWeight(weight: number): number {
  const table: Array<[number, number]> = [
    [100, 0],
    [200, 40],
    [300, 50],
    [400, 80],
    [500, 100],
    [600, 180],
    [700, 200],
    [800, 205],
    [900, 210],
  ];

  let best: [number, number] = [400, 80];

  for (const entry of table) {
    if (Math.abs(entry[0] - weight) < Math.abs(best[0] - weight)) best = entry;
  }

  return best[1];
}

/**
 * The system's font file for a family, via fontconfig's fc-match. The family
 * comes from the document's CSS, so it is passed as an argument, never
 * through a shell. fc-match always answers with some font, so a named family
 * counts only when the answer is that family; a generic family is taken as
 * fontconfig resolves it, as Chromium on Linux does.
 */
async function systemFont(
  family: string,
  weight: number,
  style: string,
): Promise<FontData | undefined> {
  const slant = style === "italic" ? 100 : style === "oblique" ? 110 : 0;
  const pattern = `${family.replace(/[\\:,-]/g, "\\$&")}:weight=${fcWeight(weight)}:slant=${slant}`;

  try {
    const { stdout } = await run("fc-match", ["-f", "%{family}\n%{file}", pattern], {
      encoding: "utf-8",
      timeout: 5000,
    });

    const [families = "", file = ""] = stdout.split("\n");
    const fontFile = file.trim();
    const generic = GENERIC_FAMILIES.has(family.toLowerCase());
    const named = families.split(",").some((f) => f.trim().toLowerCase() === family.toLowerCase());

    if (!(generic || named)) return;

    if (!/\.(ttf|otf)$/i.test(fontFile)) return;

    return { data: new Uint8Array(await fs.readFile(fontFile)) };
  } catch {
    // fc-match not available, or no such font
    return;
  }
}

/** The fields' styles and font candidates, for addAcroFormFields. */
export async function formConfig(page: PageFields): Promise<AcroFormConfig> {
  const systemFiles = new Map<string, Promise<FontData | undefined>>();
  const fieldStyles = new Map<string, FieldStyle>();

  for (const field of page.fields) {
    // A repeated name only ever gets its first field's PDF field.
    if (fieldStyles.has(field.name)) continue;

    const fonts: FontData[] = [];

    for (const family of field.families) {
      const key = JSON.stringify([family.toLowerCase(), field.weight, field.style]);
      let file = systemFiles.get(key);

      if (!file) {
        file = systemFont(family, field.weight, field.style);
        systemFiles.set(key, file);
      }

      const found = await file;

      if (found) fonts.push(found);
    }

    fieldStyles.set(field.name, {
      fontSizePx: field.fontSizePx,
      textInsetsPx: field.textInsetsPx,
      fonts,
    });
  }

  return {
    selectOptions:
      page.selects.length > 0 ? new Map(page.selects.map((s) => [s.name, s.options])) : undefined,
    fieldStyles,
  };
}
