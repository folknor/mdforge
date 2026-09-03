// PDF manipulation utilities for mdforge

// biome-ignore lint/performance/noBarrelFile: Package entry point
export {
  type AcroFormConfig,
  addAcroFormFields,
  type FieldPosition,
  type FontData,
  MARKER_URL_PREFIX,
} from "./acroform.js";

export { injectPdfMetadata, type PdfMetadata } from "./metadata.js";

export { type OutlineEntry, readOutline } from "./outline.js";
