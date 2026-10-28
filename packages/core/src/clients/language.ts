/**
 * Azure AI Language — PII entity detection via the Foundry account's built-in
 * `language` data plane (same endpoint family + key as Content Safety; no
 * extra resource).
 *
 * Used by incident de-identification to find person names / contact details /
 * identifiers in free text. Fails soft: de-ID always applies its deterministic
 * layer, and callers surface `ok: false` so reviewers know the model-backed
 * sweep was unavailable.
 *
 * With HORUS_AI_PROVIDER=aws the sweep runs on Amazon Comprehend's
 * DetectPiiEntities instead, chunked the same way.
 */
import { DetectPiiEntitiesCommand } from '@aws-sdk/client-comprehend';
import { aiProvider } from '../provider.js';
import { getComprehendClient } from './aws.js';

const API_VERSION = '2023-04-01';
/** Sync analyze-text limit is 5120 chars per document — chunk under it. */
const CHUNK_CHARS = 4_500;
const MAX_CHUNKS = 6;

export interface PiiEntity {
  text: string;
  category: string;
  confidenceScore: number;
}

export interface PiiDetection {
  ok: boolean;
  entities: PiiEntity[];
}

function config(): { url: string; key: string } | null {
  const endpoint = process.env.AZURE_LANGUAGE_ENDPOINT ?? process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY; // one Foundry account, one key
  if (!endpoint || !key) return null;
  return {
    url: new URL(`language/:analyze-text?api-version=${API_VERSION}`, endpoint).toString(),
    key,
  };
}

interface AnalyzeResponse {
  results?: {
    documents?: Array<{
      entities?: Array<{ text: string; category: string; confidenceScore: number }>;
    }>;
  };
}

/**
 * Comprehend entity types renamed to the Azure Language categories that
 * incident de-identification keys on; the rest pass through and are redacted.
 */
const COMPREHEND_CATEGORY: Record<string, string> = { NAME: 'Person', DATE_TIME: 'DateTime' };

async function detectPiiWithComprehend(trimmed: string): Promise<PiiDetection> {
  const client = getComprehendClient();
  const entities: PiiEntity[] = [];
  try {
    for (let i = 0, n = 0; i < trimmed.length && n < MAX_CHUNKS; i += CHUNK_CHARS, n++) {
      const chunk = trimmed.slice(i, i + CHUNK_CHARS);
      const res = await client.send(
        new DetectPiiEntitiesCommand({ Text: chunk, LanguageCode: 'en' }),
        { abortSignal: AbortSignal.timeout(8_000) },
      );
      for (const e of res.Entities ?? []) {
        if (e.BeginOffset === undefined || e.EndOffset === undefined || !e.Type) continue;
        entities.push({
          text: chunk.slice(e.BeginOffset, e.EndOffset),
          category: COMPREHEND_CATEGORY[e.Type] ?? e.Type,
          confidenceScore: e.Score ?? 0,
        });
      }
    }
    return { ok: true, entities };
  } catch {
    console.warn('comprehend PII detection failed: network/timeout/service error');
    return { ok: false, entities: [] };
  }
}

/** Detect PII entities in text. Never throws. */
export async function detectPii(text: string): Promise<PiiDetection> {
  const provider = aiProvider();
  if (provider === 'off') return { ok: false, entities: [] };
  if (provider === 'aws') {
    const trimmedForAws = text.trim();
    return trimmedForAws ? detectPiiWithComprehend(trimmedForAws) : { ok: false, entities: [] };
  }

  const cfg = config();
  const trimmed = text.trim();
  if (!cfg || trimmed.length === 0) return { ok: false, entities: [] };

  const documents = [];
  for (let i = 0; i < trimmed.length && documents.length < MAX_CHUNKS; i += CHUNK_CHARS) {
    documents.push({
      id: String(documents.length),
      language: 'en',
      text: trimmed.slice(i, i + CHUNK_CHARS),
    });
  }

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'PiiEntityRecognition',
        parameters: { modelVersion: 'latest' },
        analysisInput: { documents },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`language PII analyze failed: HTTP ${res.status}`);
      return { ok: false, entities: [] };
    }
    const body = (await res.json()) as AnalyzeResponse;
    const entities: PiiEntity[] = [];
    for (const doc of body.results?.documents ?? []) {
      for (const e of doc.entities ?? []) {
        entities.push({ text: e.text, category: e.category, confidenceScore: e.confidenceScore });
      }
    }
    return { ok: true, entities };
  } catch {
    console.warn('language PII analyze failed: network/timeout');
    return { ok: false, entities: [] };
  }
}
