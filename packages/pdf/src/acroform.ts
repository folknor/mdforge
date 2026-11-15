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

import {
  PDFDict,
  PDFDocument,
  type PDFFont,
  type PDFLinkAnnotation,
  PDFName,
  rgb,
} from "@folknor/pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * Marker URL prefix used to identify form field markers in PDF link annotations.
 * Must match the prefix used in @mdforge/core form-fields.ts
 */
export const MARKER_URL_PREFIX = "https://mdforge.marker/";

/**
 * Font data for embedding in PDF form fields.
 */
export interface FontData {
  family: string;
  data: Uint8Array;
  weight: number;
  style: string;
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
 * Configuration for AcroForm field generation.
 */
export interface AcroFormConfig {
  /** For select fields: map of field name to list of options */
  selectOptions?: Map<string, string[]>;
  /** Font information extracted from rendered form fields */
  formFontInfo?: {
    fontFamily: string;
    fontSize: number;
  };
  /** Embedded font data for form fields */
  embeddedFonts?: FontData[];
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
function extractAndRemoveMarkers(pdfDoc: PDFDocument): FieldPosition[] {
  const fields: FieldPosition[] = [];
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
      if (type) {
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
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer));
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

  // Calculate font size for form fields
  // CSS uses 96 DPI, PDF uses 72 DPI, so multiply by 0.75
  // If no font info available, use a reasonable default based on typical form field height
  const fontSize = config.formFontInfo
    ? Math.round(config.formFontInfo.fontSize * 0.75)
    : undefined;

  // Embed custom font if available
  let customFont: PDFFont | undefined;

  if (config.embeddedFonts && config.embeddedFonts.length > 0) {
    // Find the body font (weight 400, normal style preferred)
    const fontFamily = config.formFontInfo?.fontFamily;

    let fontData = config.embeddedFonts.find(
      (f) => f.family === fontFamily && f.weight === 400 && f.style === "normal",
    );

    // Fallback to any font with weight 400
    if (!fontData) {
      fontData = config.embeddedFonts.find((f) => f.weight === 400 && f.style === "normal");
    }

    // Fallback to first available font
    if (!fontData) {
      fontData = config.embeddedFonts[0];
    }

    if (fontData) {
      try {
        // SAFETY: @pdf-lib/fontkit is the fontkit build registerFontkit is
        // documented to take. The fork declares its own copy of the Fontkit
        // interface, which only differs in typing path.toFunction() as an
        // unknown-args function rather than Function.
        pdfDoc.registerFontkit(fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);
        customFont = await pdfDoc.embedFont(new Uint8Array(fontData.data));
      } catch {
        // Font embedding failed - continue with default Helvetica
      }
    }
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
    const page = pages[field.pageIndex];

    if (!page) continue;

    try {
      if (field.type === "text" || field.type === "textarea") {
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
          font: customFont,
        });

        if (field.type === "textarea") {
          textField.enableMultiline();
          textField.enableScrolling();
        }
      } else if (field.type === "select") {
        const dropdown = form.createDropdown(field.name);

        if (fontSize) {
          dropdown.setFontSize(fontSize);
        }

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
          font: customFont,
        });

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

  // Update all field appearances with custom font if available
  if (customFont) {
    form.updateFieldAppearances(customFont);
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
