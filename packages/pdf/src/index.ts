// PDF manipulation utilities for mdforge

export {
  type AcroFormConfig,
  addAcroFormFields,
  type FieldPosition,
  type FontData,
  MARKER_URL_PREFIX,
} from "./acroform.js";

export { readDestinations } from "./destinations.js";

export { injectPdfMetadata, type PdfMetadata } from "./metadata.js";
