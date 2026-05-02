import { AzureOpenAI } from 'openai';

let cached: AzureOpenAI | null = null;

export function getOpenAIClient(): AzureOpenAI {
  if (cached) return cached;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';

  if (!endpoint || !apiKey) {
    throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required');
  }

  cached = new AzureOpenAI({ endpoint, apiKey, apiVersion });
  return cached;
}

export const MODELS = {
  completion: process.env.AZURE_OPENAI_COMPLETION_MODEL ?? 'gpt-4o-mini',
  embedding: process.env.AZURE_OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-large',
} as const;
