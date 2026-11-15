// PDF manipulation utilities for mdforge

export {
  type AcroFormConfig,
  type AcroFormResult,
  addAcroFormFields,
  type FieldPosition,
  type FieldStyle,
  type FontData,
  MARKER_URL_PREFIX,
  SCALE_MARKER_PX,
  SCALE_MARKER_URL,
} from "./acroform.ts";

export { type PdfLayout, readPdfLayout } from "./destinations.ts";

export { injectPdfMetadata, type PdfMetadata } from "./metadata.ts";
