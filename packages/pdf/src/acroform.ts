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
 * 4. Remove the marker annotations
 */

import { createHash } from "node:crypto";
import {
  PDFDict,
  PDFDocument,
  type PDFFont,
  type PDFLinkAnnotation,
  PDFName,
  rgb,
  StandardFonts,
} from "@folknor/pdf-lib";
import fontkit, { type Font as FontkitFont } from "@pdf-lib/fontkit";

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

/** What the markers of a printed PDF said, once removed. */
interface PageMarkers {
  fields: FieldPosition[];
  scaleRects: MarkerSize[];
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
function parseMarkerUrl(url: string): { name: string; type: string; value?: string } | null {
  if (!url.startsWith(MARKER_URL_PREFIX)) return null;

  try {
    const urlObj = new URL(url);
    const name = decodeURIComponent(urlObj.pathname.slice(1)); // Remove leading /
    const type = urlObj.searchParams.get("type");
    const value = urlObj.searchParams.get("value") || undefined;

    if (!(name && type)) return null;

    return { name, type, value };
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
 * Extract marker annotations from a PDF and convert to field positions.
 * Also removes the marker annotations from the PDF.
 */
function extractAndRemoveMarkers(pdfDoc: PDFDocument): PageMarkers {
  const fields: FieldPosition[] = [];
  const scaleRects: MarkerSize[] = [];
  const pages = pdfDoc.getPages();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];

    if (!page) continue;

    // Find all link annotations that are markers
    const markers: PDFLinkAnnotation[] = [];

    for (const link of page.getLinkAnnotations()) {
      const url = link.getUrl();

      if (url?.startsWith(MARKER_URL_PREFIX)) {
        markers.push(link);
      }
    }

    // Extract field positions and remove markers
    for (const link of markers) {
      const url = link.getUrl();

      if (!url) continue;

      const markerInfo = parseMarkerUrl(url);

      if (!markerInfo) continue;

      const rect = link.getRectangle();
      const type = parseFieldType(markerInfo.type);

      // A marker with an unknown type gets no field, but is still removed.
      if (markerInfo.type === "scale") {
        scaleRects.push(rect);
      } else if (type) {
        fields.push({
          name: markerInfo.name,
          type,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          pageIndex,
          value: markerInfo.value,
        });
      }

      page.removeAnnotation(link);
    }
  }

  return { fields, scaleRects };
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
 * @returns Modified PDF with AcroForm fields, and warnings
 */
export async function addAcroFormFields(
  pdfBuffer: Buffer | Uint8Array,
  config: AcroFormConfig = {},
): Promise<AcroFormResult> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer));
  const pages = pdfDoc.getPages();
  const warnings: string[] = [];

  if (pages.length === 0) {
    return { pdf: await pdfDoc.save(), warnings };
  }

  // Extract marker annotations and get field positions
  const { fields, scaleRects } = extractAndRemoveMarkers(pdfDoc);

  if (fields.length === 0) {
    return { pdf: await pdfDoc.save(), warnings };
  }

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

    try {
      // Each field gets the font and size it was printed with. Markers are
      // matched to the page's fields by name; a repeated name only ever gets
      // its first field (creating the second fails below).
      const style = config.fieldStyles?.get(field.name);
      const fontSize = fieldFontSize(style, ptPerPx);

      if (field.type === "text" || field.type === "textarea") {
        const font = await fonts.pick(style?.fonts ?? [], []);
        const textField = form.createTextField(field.name);

        if (fontSize) {
          textField.setFontSize(fontSize);
        }

        textField.addToPage(page, {
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          borderWidth: 0,
          backgroundColor: undefined, // Transparent - show HTML styling through
          font,
        });

        if (field.type === "textarea") {
          textField.enableMultiline();
          textField.enableScrolling();
        }

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
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          borderWidth: 0,
          backgroundColor: undefined, // Transparent
          font,
        });
        dropdown.updateAppearances(font);

        // Draw a down arrow indicator on the right side
        const arrowFontSize = fontSize ?? 12;
        const arrowWidth = Math.min(arrowFontSize * 0.6, field.height * 0.3);
        const arrowHeight = arrowWidth * 0.6;
        const arrowPadding = 4;
        const arrowX = field.x + field.width - arrowPadding - arrowWidth;
        // Arrow extends downward from y, so place top at center + half height
        const arrowY = field.y + (field.height + arrowHeight) / 2;
        // SVG path for downward triangle (SVG coords: Y increases downward):
        // Top-left -> Top-right -> Bottom-center
        const arrowPath = `M 0 0 L ${arrowWidth} 0 L ${arrowWidth / 2} ${arrowHeight} Z`;
        page.drawSvgPath(arrowPath, {
          x: arrowX,
          y: arrowY,
          color: rgb(0, 0, 0),
          borderWidth: 0,
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

  // Every field's appearance was built with its own font above; letting save
  // rebuild them would use one default font for all.
  return { pdf: await pdfDoc.save({ updateFieldAppearances: false }), warnings };
}
