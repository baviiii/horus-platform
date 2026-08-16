/**
 * Embedding helpers — batched calls to the Azure OpenAI embedding deployment.
 * The openai SDK already retries 429/5xx twice with backoff, so we only add
 * batching (API max is 2048 inputs, but small batches keep request sizes sane).
 */
import { getOpenAIClient, MODELS } from '../clients/openai.js';
import { EMBEDDING_DIMENSIONS } from './store.js';

const BATCH_SIZE = 16;
/** text-embedding-3-large's native width; anything less is a Matryoshka truncation. */
const NATIVE_DIMENSIONS = 3072;

/** Embed many texts, preserving input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAIClient();
  const out: number[][] = new Array(texts.length);

  // text-embedding-3-* supports Matryoshka truncation: asking for fewer
  // dimensions shrinks index storage ~linearly for a small recall cost.
  // Must match the index's vectorSearchDimensions exactly.
  const dimensions =
    EMBEDDING_DIMENSIONS !== NATIVE_DIMENSIONS ? { dimensions: EMBEDDING_DIMENSIONS } : {};

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({
      model: MODELS.embedding,
      input: batch,
      ...dimensions,
    });
    for (const item of res.data) out[i + item.index] = item.embedding;
  }
  return out;
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error('Embedding call returned no vector');
  return vector;
}
