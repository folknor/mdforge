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
} from "./acroform.js";

export { type PdfLayout, readPdfLayout } from "./destinations.js";

export { injectPdfMetadata, type PdfMetadata } from "./metadata.js";
