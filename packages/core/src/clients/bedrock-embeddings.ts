/**
 * Amazon Titan Text Embeddings V2 on Bedrock.
 *
 * Titan takes one text per InvokeModel call, so batches fan out with bounded
 * concurrency. It supports 256, 512 or 1024 dimensions (1024 is native);
 * other requested widths snap to the nearest supported one at or above them.
 */
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockRuntimeClient } from './aws.js';

export const TITAN_DIMENSIONS = [256, 512, 1024] as const;
export type TitanDimensions = (typeof TITAN_DIMENSIONS)[number];

export function titanModelId(): string {
  return process.env.HORUS_BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
}

export function titanDimensions(requested?: number): TitanDimensions {
  if (!requested) return 1024;
  return TITAN_DIMENSIONS.find((d) => d >= requested) ?? 1024;
}

interface TitanResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

const CONCURRENCY = 8;

export interface TitanEmbedOptions {
  dimensions?: TitanDimensions;
  /** Per-call abort/timeout; the SDK's own retries still apply. */
  abortSignal?: AbortSignal;
}

export async function titanEmbed(
  texts: string[],
  options: TitanEmbedOptions = {},
): Promise<{ vectors: number[][]; tokens: number; dimensions: TitanDimensions }> {
  const dimensions = options.dimensions ?? 1024;
  const client = getBedrockRuntimeClient();
  const vectors: number[][] = new Array(texts.length);
  let tokens = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < texts.length) {
      const i = next++;
      const res = await client.send(
        new InvokeModelCommand({
          modelId: titanModelId(),
          contentType: 'application/json',
          accept: 'application/json',
          // Normalised vectors make cosine distance well-behaved and let
          // callers take a plain dot product.
          // Titan rejects empty input and caps it at 50,000 characters.
          body: JSON.stringify({
            inputText: texts[i]?.slice(0, 50_000) || ' ',
            dimensions,
            normalize: true,
          }),
        }),
        { abortSignal: options.abortSignal },
      );
      const body = JSON.parse(new TextDecoder().decode(res.body)) as TitanResponse;
      vectors[i] = body.embedding;
      tokens += body.inputTextTokenCount ?? 0;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
  return { vectors, tokens, dimensions };
}
