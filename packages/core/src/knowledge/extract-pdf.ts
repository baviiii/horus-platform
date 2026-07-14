/**
 * PDF → text via unpdf (pdf.js under the hood — pure JS, no native deps).
 *
 * Handles text-born PDFs. Scanned/image PDFs come back near-empty; callers
 * should surface that instead of indexing garbage. Azure Document
 * Intelligence is the production upgrade path for OCR + tables + charts.
 */
import { extractText, getDocumentProxy } from 'unpdf';

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  return {
    text: text.replace(/\n{3,}/g, '\n\n').trim(),
    pageCount: totalPages,
  };
}
