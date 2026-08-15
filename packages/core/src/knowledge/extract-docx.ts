/**
 * .docx → text via mammoth (pure JS, no native deps).
 *
 * Providers' incident forms are as often Word documents as PDFs; template
 * absorption accepts both. Formatting is deliberately discarded — the
 * absorber wants the words, not the layout.
 */
import mammoth from 'mammoth';

export interface ExtractedDocx {
  text: string;
}

export async function extractDocx(data: Uint8Array): Promise<ExtractedDocx> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return { text: result.value.replace(/\n{3,}/g, '\n\n').trim() };
}
