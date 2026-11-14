import { PDFDocument } from "@folknor/pdf-lib";

/**
 * PDF metadata configuration
 */
export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

/**
 * Inject metadata into a PDF buffer
 */
export async function injectPdfMetadata(
  pdfBuffer: Buffer | Uint8Array,
  metadata: PdfMetadata,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer));

  if (metadata.title) {
    pdfDoc.setTitle(metadata.title);
  }

  if (metadata.author) {
    pdfDoc.setAuthor(metadata.author);
  }

  if (metadata.subject) {
    pdfDoc.setSubject(metadata.subject);
  }

  if (metadata.keywords && metadata.keywords.length > 0) {
    pdfDoc.setKeywords(metadata.keywords);
  }

  if (metadata.creator) {
    pdfDoc.setCreator(metadata.creator);
  }

  if (metadata.producer) {
    pdfDoc.setProducer(metadata.producer);
  }

  // Always set modification date to now
  pdfDoc.setModificationDate(new Date());

  return pdfDoc.save();
}
