/**
 * AcroForm field generation for fillable PDFs.
 *
 * This module post-processes the PDFs Chromium prints (in either renderer) to add real
 * AcroForm fields, making them fillable in PDF readers.
 *
 * The approach uses marker-based positioning:
 * 1. Form fields include invisible link markers in HTML
 * 2. These links become PDF link annotations with exact page + coordinates
 * 3. We read the annotations, add AcroForm fields at those positions
 * 4. Remove the marker annotations, handing each one's place in the tagged
 *    structure to its widget (structure.ts)
 */

import { createHash } from "node:crypto";
import {
  beginMarkedContent,
  endMarkedContent,
  PDFDict,
  PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
  PDFHexString,
  type PDFLinkAnnotation,
  PDFName,
  type PDFPage,
  type PDFRef,
  rgb,
  StandardFonts,
} from "@folknor/pdf-lib";
import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";
import { TaggedStructure } from "./structure.ts";

/**
 * Marker URL prefix used to identify form field markers in PDF link annotations.
 * Must match the prefix used in @mdforge/core form-fields.ts
 */
export const MARKER_URL_PREFIX = "https://mdforge.marker/";

/**
 * A font file offered for a form field: TrueType or OpenType bytes.
 */
export interface FontData {
  data: Uint8Array;
}

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
  /** The field's label (a group's legend for checkbox/radio options), if it has one. */
  label?: string;
  /** For checkbox/radio fields: the option's visible text. */
  option?: string;
  /** The marker annotation the position was read from. */
  marker: PDFRef;
}

/**
 * The page-scale marker: a fixed-position link of exactly SCALE_MARKER_PX
 * square CSS px that the renderer adds before printing. Chromium repeats a
 * fixed element on every printed page, so any page range keeps one, and its
 * annotation's size gives the printed points per CSS px - which carries
 * `pdf_options.scale` and any fitting Chromium did.
 */
export const SCALE_MARKER_URL = `${MARKER_URL_PREFIX}page?type=scale`;
export const SCALE_MARKER_PX = 100;

/**
 * How one text, textarea or select field was styled, read from the live page
 * after printing.
 */
export interface FieldStyle {
  /** The control's computed font size, in CSS px. */
  fontSizePx: number;
  /** Control content-box edges relative to its marker, in CSS px. */
  textInsetsPx?: { left: number; top: number; right: number; bottom: number };
  /**
   * Font files for the field, best first; the first that can be embedded,
   * covers the field's characters and does not clash with another file's
   * resource name is used.
   */
  fonts: FontData[];
}

/**
 * Configuration for AcroForm field generation.
 */
export interface AcroFormConfig {
  /** For select fields: map of field name to list of options */
  selectOptions?: Map<string, string[]>;
  /** Style of each text, textarea and select field, by field name */
  fieldStyles?: Map<string, FieldStyle>;
}

/** A fillable PDF and what could not be carried over from the page. */
export interface AcroFormResult {
  pdf: Uint8Array;
  warnings: string[];
}

/**
 * Characters every field font must have: printable ASCII is what a user can
 * be relied on to type. A select also needs its options' characters.
 */
const REQUIRED_CODE_POINTS = Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i);

/** The printed size of a page-scale marker, in points. */
interface MarkerSize {
  width: number;
  height: number;
}

/** What the markers of a printed PDF said, once removed from their pages. */
interface PageMarkers {
  fields: FieldPosition[];
  scaleRects: MarkerSize[];
  /** Every marker annotation removed, with its page. */
  markers: Array<{ ref: PDFRef; page: PDFPage }>;
  warnings: string[];
}

/** A parsed candidate font file. */
interface ParsedFont {
  bytes: Uint8Array;
  font: FontkitFont;
  /** The resource name the fork gives it (its PostScript name). */
  name: string;
}

/**
 * WOFF and WOFF2 files are refused. The fork re-encodes a web font to a plain
 * font program only when it was parsed by the fork's own vendored fontkit,
 * which its package does not export; through @pdf-lib/fontkit it writes the
 * compressed container as the font program, which viewers reject (poppler
 * draws the field's text blank).
 */
function isWebFontContainer(data: Uint8Array): boolean {
  const magic = String.fromCharCode(...data.subarray(0, 4));

  return magic === "wOFF" || magic === "wOF2";
}

/**
 * The fonts of one PDF's fields. Every font a field uses is registered in the
 * AcroForm's /DR under the name its /DA names, so a viewer regenerating the
 * appearance as the user types finds the same font. The fork names a font's
 * resource by its PostScript name, so two different files with the same
 * PostScript name cannot both be used; the second is passed over for the
 * field's next candidate rather than substituted.
 */
class FieldFonts {
  private readonly parsed = new Map<string, ParsedFont | null>();
  private readonly embedded = new Map<string, PDFFont | null>();
  /** Resource name -> content hash of the file registered under it. */
  private readonly names = new Map<string, string>([["Helvetica", "standard:Helvetica"]]);
  private helvetica: PDFFont | undefined;
  private readonly pdfDoc: PDFDocument;

  constructor(pdfDoc: PDFDocument) {
    this.pdfDoc = pdfDoc;
    // SAFETY: @pdf-lib/fontkit is the fontkit build registerFontkit is
    // documented to take. The fork declares its own copy of the Fontkit
    // interface, which only differs in typing path.toFunction() as an
    // unknown-args function rather than Function.
    pdfDoc.registerFontkit(fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);
  }

  /** The first usable candidate for a field, else Helvetica. */
  async pick(candidates: FontData[], extraText: string[]): Promise<PDFFont> {
    const required = new Set(REQUIRED_CODE_POINTS);

    for (const text of extraText) {
      for (const char of text) {
        const codePoint = char.codePointAt(0);

        if (codePoint !== undefined && codePoint >= 0x20) required.add(codePoint);
      }
    }

    for (const candidate of candidates) {
      const parsed = this.parse(candidate.data);

      if (!parsed) continue;

      const [hash, face] = parsed;

      if (![...required].every((cp) => face.font.hasGlyphForCodePoint(cp))) continue;

      const owner = this.names.get(face.name);

      if (owner !== undefined && owner !== hash) continue;

      const font = await this.embed(hash, face);

      if (font) return font;
    }

    return this.standard();
  }

  private parse(data: Uint8Array): [string, ParsedFont] | null {
    const hash = createHash("sha256").update(data).digest("hex");
    let parsed = this.parsed.get(hash);

    if (parsed === undefined) {
      try {
        const font = isWebFontContainer(data) ? null : fontkit.create(data);
        parsed = font && { bytes: data, font, name: font.postscriptName || "Font" };
      } catch {
        parsed = null;
      }

      this.parsed.set(hash, parsed);
    }

    return parsed && [hash, parsed];
  }

  /**
   * Embed a file once. The fork defers writing a font until save, so the
   * embedding is forced here, where a failure can still pass to the next
   * candidate instead of failing the whole PDF.
   */
  private async embed(hash: string, face: ParsedFont): Promise<PDFFont | null> {
    const known = this.embedded.get(hash);

    if (known !== undefined) return known;

    let font: PDFFont | null;

    try {
      font = await this.pdfDoc.embedFont(new Uint8Array(face.bytes));
      await font.embed();
      this.register(hash, font);
    } catch {
      font = null;
    }

    this.embedded.set(hash, font);

    return font;
  }

  private async standard(): Promise<PDFFont> {
    if (!this.helvetica) {
      this.helvetica = await this.pdfDoc.embedFont(StandardFonts.Helvetica);
      this.register("standard:Helvetica", this.helvetica);
    }

    return this.helvetica;
  }

  private register(hash: string, font: PDFFont): void {
    this.names.set(font.name, hash);

    const dr = this.subDict(this.pdfDoc.getForm().acroForm.dict, "DR");
    this.subDict(dr, "Font").set(PDFName.of(font.name), font.ref);
  }

  private subDict(parent: PDFDict, key: string): PDFDict {
    const existing = parent.lookup(PDFName.of(key));

    if (existing instanceof PDFDict) return existing;

    const created = this.pdfDoc.context.obj({});
    parent.set(PDFName.of(key), created);

    return created;
  }
}

/**
 * Printed points per CSS px from the page-scale markers, or undefined when
 * there is none or they disagree. Width and height must agree (an unequal
 * pair means the marker was clipped or transformed), as must every page's.
 */
function pointsPerPx(rects: MarkerSize[]): number | undefined {
  let ratio: number | undefined;

  for (const { width, height } of rects) {
    const x = width / SCALE_MARKER_PX;
    const y = height / SCALE_MARKER_PX;

    if (!(x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y))) return;

    if (Math.abs(x - y) > 0.01 * Math.max(x, y)) return;

    const mean = (x + y) / 2;

    if (ratio !== undefined && Math.abs(ratio - mean) > 0.01 * ratio) return;

    ratio ??= mean;
  }

  return ratio;
}

/** Printed points for a field's CSS font size, or undefined to leave it to the fork. */
function fieldFontSize(
  style: FieldStyle | undefined,
  ptPerPx: number | undefined,
): number | undefined {
  if (!(style && ptPerPx)) return;

  const size = style.fontSizePx * ptPerPx;

  // A zero size would be written as `0 Tf`, which PDF reads as auto-size.
  if (!(Number.isFinite(size) && size > 0)) return;

  return Math.round(size * 100) / 100;
}

/**
 * Parse a marker URL to extract field information.
 * URL format: https://mdforge.marker/{name}?type={type}&value={value}
 */
function parseMarkerUrl(
  url: string,
): { name: string; type: string; value?: string; label?: string; option?: string } | null {
  if (!url.startsWith(MARKER_URL_PREFIX)) return null;

  try {
    const urlObj = new URL(url);
    const name = decodeURIComponent(urlObj.pathname.slice(1)); // Remove leading /
    const type = urlObj.searchParams.get("type");
    const value = urlObj.searchParams.get("value") || undefined;
    const label = urlObj.searchParams.get("label") || undefined;
    const option = urlObj.searchParams.get("option") || undefined;

    if (!(name && type)) return null;

    return { name, type, value, label, option };
  } catch {
    return null;
  }
}

/** Narrow a marker's `type` parameter to a field type we know how to build. */
function parseFieldType(type: string): FieldPosition["type"] | null {
  switch (type) {
    case "text":
    case "textarea":
    case "select":
    case "checkbox":
    case "radio":
      return type;
    default:
      return null;
  }
}

/**
 * Take every marker annotation (any link under MARKER_URL_PREFIX, readable
 * or not) off its page, and read field positions and page-scale sizes from
 * them. The annotation objects stay until the structure pass in
 * addAcroFormFields has handed their structure over or detached it.
 */
function extractAndRemoveMarkers(pdfDoc: PDFDocument): PageMarkers {
  const fields: FieldPosition[] = [];
  const scaleRects: MarkerSize[] = [];
  const markers: PageMarkers["markers"] = [];
  const warnings: string[] = [];
  const pages = pdfDoc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];

    if (!page) continue;

    const found: PDFLinkAnnotation[] = [];

    for (const link of page.getLinkAnnotations()) {
      if (link.getUrl()?.startsWith(MARKER_URL_PREFIX)) found.push(link);
    }

    for (const link of found) {
      const ref = pdfDoc.context.getObjectRef(link.dict);

      page.removeAnnotation(link);

      if (ref) markers.push({ ref, page });

      const markerInfo = parseMarkerUrl(link.getUrl() ?? "");

      if (markerInfo?.type === "scale") {
        scaleRects.push(link.getRectangle());
        continue;
      }

      const type = markerInfo && parseFieldType(markerInfo.type);

      if (!(markerInfo && type && ref)) {
        warnings.push(`A form field marker that could not be read was ignored: ${link.getUrl()}`);
        continue;
      }

      const rect = link.getRectangle();

      fields.push({
        name: markerInfo.name,
        type,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pageIndex,
        value: markerInfo.value,
        label: markerInfo.label,
        option: markerInfo.option,
        marker: ref,
      });
    }
  }

  return { fields, scaleRects, markers, warnings };
}

/** A widget made for one marker, and what describes it in the structure. */
interface MarkerWidget {
  widget: PDFRef;
  name: string;
  /** For a radio option: its text, as the /Alt of its /Form element. */
  alt?: string;
}

/**
 * The widget the last addToPage/addOptionToPage gave a field. Those calls
 * append it to the field's widgets and the page's /Annots synchronously, so
 * it is the field's last widget, and it must be on the page.
 */
function lastWidget(pdfDoc: PDFDocument, field: PDFField, page: PDFPage): PDFRef {
  const widget = field.acroField.getWidgets().at(-1);
  const ref = widget && pdfDoc.context.getObjectRef(widget.dict);
  const annots = page.node.Annots()?.asArray() ?? [];

  if (!(ref && annots.includes(ref))) {
    throw new Error(`The widget for field "${field.getName()}" is not on its page.`);
  }

  return ref;
}

/** A field's /TU, the name assistive technology reads for it. */
function setDescription(field: PDFField, text: string): void {
  field.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(text));
}

/**
 * Create one field, all or nothing: if building it throws, a field it
 * created is removed again (with its widgets, from its pages), so no widget
 * of a failed field survives. Widgets are published only on success. A field
 * that already existed (a repeated name) is never touched: creating it again
 * throws before changing anything.
 */
async function createField(
  form: PDFForm,
  name: string,
  built: Map<PDFRef, MarkerWidget>,
  warnings: string[],
  build: (made: Map<PDFRef, MarkerWidget>) => Promise<void> | void,
): Promise<boolean> {
  const existed = form.getFieldMaybe(name) !== undefined;
  const made = new Map<PDFRef, MarkerWidget>();

  try {
    await build(made);
  } catch {
    const partial = existed ? undefined : form.getFieldMaybe(name);

    // A failing rollback escapes: the PDF could no longer be trusted.
    if (partial) form.removeField(partial);

    warnings.push(
      existed
        ? `The fillable field name "${name}" is used more than once; only its first field is fillable.`
        : `The fillable field "${name}" could not be created, so the PDF has no field for it.`,
    );

    return false;
  }

  for (const [marker, widget] of made) built.set(marker, widget);

  return true;
}

/**
 * Add AcroForm fields to a PDF using marker-based positioning.
 *
 * This function:
 * 1. Reads marker link annotations from the PDF and removes them
 * 2. Extracts field positions from the annotation rectangles
 * 3. Adds AcroForm fields at those exact positions
 * 4. Gives each widget its marker's place in the tagged structure
 *    (structure.ts), detaches markers that got no widget, and deletes the
 *    marker annotations
 *
 * @param pdfBuffer - The PDF buffer to modify
 * @param config - Optional configuration (e.g., select options)
 * @returns Modified PDF with AcroForm fields, and warnings
 */
export async function addAcroFormFields(
  pdfBuffer: Buffer | Uint8Array,
  config: AcroFormConfig = {},
): Promise<AcroFormResult> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer));
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    return { pdf: await pdfDoc.save(), warnings: [] };
  }

  const { fields, scaleRects, markers, warnings } = extractAndRemoveMarkers(pdfDoc);
  const built = new Map<PDFRef, MarkerWidget>();

  if (fields.length > 0) {
    await buildFields(pdfDoc, fields, scaleRects, config, built, warnings);
  }

  const structure = TaggedStructure.of(pdfDoc);

  for (const { ref, page } of markers) {
    const made = built.get(ref);

    if (structure) {
      const slot = made && structure.slotFor(ref);

      if (made && slot) {
        structure.give(slot, ref, made.widget, page.ref, made.alt);
      } else {
        structure.detach(ref);

        if (made) {
          warnings.push(
            `The fillable field "${made.name}" was added, but not to the PDF's tagged structure.`,
          );
        }
      }
    }

    pdfDoc.context.delete(ref);
  }

  // Every field's appearance was built with its own font; letting save
  // rebuild them would use one default font for all.
  return { pdf: await pdfDoc.save({ updateFieldAppearances: false }), warnings };
}

/** A widget rectangle in PDF points, origin at its bottom left. */
interface WidgetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The widget rectangle for a text, textarea or select field: the control's
 * measured content box inside its marker, scaled to points. The geometry only
 * refines placement and never decides whether a field exists: without a
 * printed scale or insets, or when the content box comes out empty or
 * non-finite, the whole marker box is used and the field is still created.
 */
function contentBox(
  marker: WidgetBox,
  inset: FieldStyle["textInsetsPx"],
  ptPerPx: number | undefined,
): WidgetBox {
  const whole: WidgetBox = { x: marker.x, y: marker.y, width: marker.width, height: marker.height };

  if (!inset || !ptPerPx) return whole;

  // The fork's text and dropdown appearance providers inset by 1pt even with
  // borderWidth: 0. Expand the widget so its text bounds, rather than its
  // annotation rectangle, match the HTML content box. PDF y grows upward, so
  // the bottom inset moves the origin.
  const box: WidgetBox = {
    x: marker.x + inset.left * ptPerPx - 1,
    y: marker.y + inset.bottom * ptPerPx - 1,
    width: marker.width - (inset.left + inset.right) * ptPerPx + 2,
    height: marker.height - (inset.top + inset.bottom) * ptPerPx + 2,
  };

  if (!Object.values(box).every(Number.isFinite) || box.width <= 2 || box.height <= 2) {
    return whole;
  }

  return box;
}

async function buildFields(
  pdfDoc: PDFDocument,
  fields: FieldPosition[],
  scaleRects: MarkerSize[],
  config: AcroFormConfig,
  built: Map<PDFRef, MarkerWidget>,
  warnings: string[],
): Promise<void> {
  const pages = pdfDoc.getPages();
  const ptPerPx = pointsPerPx(scaleRects);

  if (ptPerPx === undefined && config.fieldStyles && config.fieldStyles.size > 0) {
    warnings.push(
      "The printed page scale could not be measured, so fillable fields use a default text size instead of the document's.",
    );
  }

  const form = pdfDoc.getForm();
  const fonts = new FieldFonts(pdfDoc);

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

    // Each field gets the font and size it was printed with. Markers are
    // matched to the page's fields by name; a repeated name only ever gets
    // its first field (creating the second fails, with a warning).
    const style = config.fieldStyles?.get(field.name);
    const fontSize = fieldFontSize(style, ptPerPx);
    const box = contentBox(field, style?.textInsetsPx, ptPerPx);
    let arrowSize: number | undefined;

    const created = await createField(form, field.name, built, warnings, async (made) => {
      if (field.type === "text" || field.type === "textarea") {
        const font = await fonts.pick(style?.fonts ?? [], []);
        const textField = form.createTextField(field.name);

        if (fontSize) {
          textField.setFontSize(fontSize);
        }

        textField.addToPage(page, {
          ...box,
          borderWidth: 0,
          backgroundColor: undefined, // Transparent - show HTML styling through
          font,
        });
        made.set(field.marker, { widget: lastWidget(pdfDoc, textField, page), name: field.name });

        if (field.type === "textarea") {
          textField.enableMultiline();
          textField.enableScrolling();
        }

        setDescription(textField, field.label ?? field.name);
        textField.updateAppearances(font);
      } else if (field.type === "select") {
        const options = config.selectOptions?.get(field.name);
        const font = await fonts.pick(style?.fonts ?? [], options ?? []);
        const dropdown = form.createDropdown(field.name);

        if (fontSize) {
          dropdown.setFontSize(fontSize);
        }

        if (options) {
          dropdown.addOptions(options);
        }

        dropdown.addToPage(page, {
          ...box,
          borderWidth: 0,
          backgroundColor: undefined, // Transparent
          font,
        });
        made.set(field.marker, { widget: lastWidget(pdfDoc, dropdown, page), name: field.name });
        setDescription(dropdown, field.label ?? field.name);
        dropdown.updateAppearances(font);
        arrowSize = fontSize ?? 12;
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
        made.set(field.marker, { widget: lastWidget(pdfDoc, checkbox, page), name: field.name });
        setDescription(checkbox, field.label ?? field.option ?? field.name);
      }
    });

    // Drawn only once the dropdown exists: a rolled-back field cannot take
    // page content back.
    if (created && arrowSize !== undefined) drawDropdownArrow(page, field, arrowSize);
  }

  // Add radio button groups, each all or nothing
  for (const [name, options] of radioGroups) {
    const label = options.find((opt) => opt.label)?.label;

    await createField(form, name, built, warnings, (made) => {
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
        made.set(opt.marker, {
          widget: lastWidget(pdfDoc, radioGroup, page),
          name,
          alt: opt.option ?? opt.value,
        });
      }

      setDescription(radioGroup, label ?? name);
    });
  }

  // Add checkbox groups (each checkbox needs unique name)
  for (const [name, options] of checkboxGroups) {
    for (const opt of options) {
      const page = pages[opt.pageIndex];

      if (!page) continue;

      const fieldName = `${name}_${opt.value}`;
      const option = opt.option ?? opt.value ?? "";

      await createField(form, fieldName, built, warnings, (made) => {
        const size = Math.min(opt.width, opt.height);
        const checkbox = form.createCheckBox(fieldName);
        checkbox.addToPage(page, {
          x: opt.x,
          y: opt.y,
          width: size,
          height: size,
          borderWidth: 0,
          backgroundColor: undefined, // Transparent
        });
        made.set(opt.marker, { widget: lastWidget(pdfDoc, checkbox, page), name: fieldName });
        setDescription(checkbox, opt.label ? `${opt.label}: ${option}` : option);
      });
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
}

/**
 * A down arrow on the right of a dropdown. It is page content in a tagged
 * PDF, and decoration, so it is marked as an artifact.
 */
function drawDropdownArrow(page: PDFPage, field: FieldPosition, fontSize: number): void {
  const arrowWidth = Math.min(fontSize * 0.6, field.height * 0.3);
  const arrowHeight = arrowWidth * 0.6;
  const arrowPadding = 4;
  const arrowX = field.x + field.width - arrowPadding - arrowWidth;
  // Arrow extends downward from y, so place top at center + half height
  const arrowY = field.y + (field.height + arrowHeight) / 2;
  // SVG path for downward triangle (SVG coords: Y increases downward):
  // Top-left -> Top-right -> Bottom-center
  const arrowPath = `M 0 0 L ${arrowWidth} 0 L ${arrowWidth / 2} ${arrowHeight} Z`;

  page.pushOperators(beginMarkedContent("Artifact"));
  page.drawSvgPath(arrowPath, {
    x: arrowX,
    y: arrowY,
    color: rgb(0, 0, 0),
    borderWidth: 0,
  });
  page.pushOperators(endMarkedContent());
}
