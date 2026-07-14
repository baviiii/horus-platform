/**
 * Paragraph-aware text chunker.
 *
 * Splits on blank lines, packs paragraphs up to ~targetChars, and carries a
 * tail overlap into the next chunk so answers that straddle a boundary stay
 * retrievable. Oversized paragraphs fall back to sentence, then hard splits.
 */

export interface ChunkOptions {
  /** Soft target size per chunk, in characters (~4 chars ≈ 1 token). */
  targetChars?: number;
  /** Hard maximum before a paragraph is force-split. */
  maxChars?: number;
  /** Characters of trailing context carried into the next chunk. */
  overlapChars?: number;
}

export interface TextChunk {
  text: string;
  ix: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetChars: 3200,
  maxChars: 4800,
  overlapChars: 300,
};

function splitOversized(paragraph: string, maxChars: number): string[] {
  // Prefer sentence boundaries; fall back to hard slices.
  const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        parts.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        parts.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + sentence.length > maxChars && current) {
      parts.push(current);
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function chunkText(raw: string, options: ChunkOptions = {}): TextChunk[] {
  const { targetChars, maxChars, overlapChars } = { ...DEFAULTS, ...options };

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > maxChars ? splitOversized(p, maxChars) : [p]));

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetChars) {
      chunks.push(current);
      // Seed the next chunk with the tail of this one for continuity.
      const tail = current.slice(-overlapChars);
      const tailStart = tail.indexOf(' ');
      current = tailStart > 0 ? `…${tail.slice(tailStart)}\n\n` : '';
    }
    current += (current && !current.endsWith('\n\n') ? '\n\n' : '') + paragraph;
  }
  if (current.trim()) chunks.push(current);

  return chunks
    .map((text) => text.trim())
    .filter((text) => text.length >= 40) // drop crumbs not worth indexing
    .map((text, ix) => ({ text, ix }));
}
