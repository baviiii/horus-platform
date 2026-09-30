/**
 * Stateless embedding for callers that rank on the fly.
 *
 * CareerCraft scores ~50 jobs or articles against one profile per search: it
 * sends the profile text plus every item text in one call, gets vectors back,
 * and takes the cosine itself. Nothing is stored on either side, so there is
 * no vector to go stale when a profile changes and nothing to migrate if the
 * model does.
 *
 * Distinct from `knowledge/embeddings.ts`, which feeds the search index and
 * must stay on the model the index was built with.
 */
import { getOpenAIClient, MODELS } from '../clients/openai.js';

export type EmbedModel = 'small' | 'large';

export const EMBED_MAX_INPUTS = 128;

/**
 * Per-input character cap, applied here so it bounds cost for every caller.
 * ~500 tokens: a job title plus the opening of its description carries the
 * role; the rest of a JSearch description is benefits and boilerplate that
 * would multiply the bill several times over without changing the ranking.
 */
export const EMBED_MAX_CHARS = 2000;

export interface EmbedOptions {
  model?: EmbedModel;
  /** Matryoshka truncation — fewer dimensions, smaller response, small recall cost. */
  dimensions?: number;
}

export interface EmbedResult {
  /** One per input, in input order. */
  vectors: number[][];
  /** Deployment that produced them. Vectors from different models are not comparable. */
  model: string;
  dimensions: number;
  tokens: number;
}

export async function embed(input: string[], options: EmbedOptions = {}): Promise<EmbedResult> {
  if (input.length === 0) throw new Error('embed() needs at least one input');
  if (input.length > EMBED_MAX_INPUTS) {
    throw new Error(`embed() takes at most ${EMBED_MAX_INPUTS} inputs, got ${input.length}`);
  }

  const deployment = options.model === 'large' ? MODELS.embedding : MODELS.embeddingSmall;

  // One request for the whole batch: this runs inside a user's search, so
  // sequential sub-batches would add their latencies together.
  const res = await getOpenAIClient().embeddings.create(
    {
      model: deployment,
      input: input.map((text) => text.slice(0, EMBED_MAX_CHARS)),
      ...(options.dimensions ? { dimensions: options.dimensions } : {}),
    },
    // The caller falls back to ranking without similarity, so a fast failure
    // is worth more than a slow success. No retries at all: on a 429 the SDK
    // sleeps for Azure's Retry-After (up to 59 s) before retrying, which would
    // stall a user's search for the better part of a minute. The SDK default
    // is a 10-minute timeout with two retries.
    { timeout: 8_000, maxRetries: 0 },
  );

  const vectors: number[][] = new Array(input.length);
  for (const item of res.data) vectors[item.index] = item.embedding;

  return {
    vectors,
    model: deployment,
    dimensions: vectors[0]?.length ?? 0,
    tokens: res.usage.prompt_tokens,
  };
}
