/**
 * Azure AI Language — PII entity detection via the Foundry account's built-in
 * `language` data plane (same endpoint family + key as Content Safety; no
 * extra resource).
 *
 * Used by incident de-identification to find person names / contact details /
 * identifiers in free text. Fails soft: de-ID always applies its deterministic
 * layer, and callers surface `ok: false` so reviewers know the model-backed
 * sweep was unavailable.
 */

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

/** Detect PII entities in text. Never throws. */
export async function detectPii(text: string): Promise<PiiDetection> {
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
