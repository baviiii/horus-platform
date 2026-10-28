/**
 * Content Safety moderation via the Foundry account's built-in
 * `contentsafety` data plane (same endpoint family + key as OpenAI — no
 * extra resource, no extra SDK).
 *
 * Screens user-supplied text (chat input, crawled pages, PDF text) before
 * it reaches models or the shared index. Fails open on service errors:
 * a moderation outage must not take the product down with it.
 *
 * With HORUS_AI_PROVIDER=aws the same verdicts come from Bedrock Guardrails
 * (`guardrails.ts`). With it `off`, nothing is screened — nothing reaches a
 * model either, so there is nothing to protect.
 */
import { aiProvider } from '../provider.js';
import { moderateImageWithGuardrail, moderateTextWithGuardrail } from './guardrails.js';

const API_VERSION = '2024-09-01';
const MAX_ANALYZE_CHARS = 10_000; // service limit per text:analyze call
const BLOCK_SEVERITY = 4; // FourSeverityLevels: 0 safe / 2 low / 4 medium / 6 high

export interface ModerationVerdict {
  blocked: boolean;
  category?: string;
  severity?: number;
}

interface CategoryAnalysis {
  category: string;
  severity: number;
}

function config(): { url: string; key: string } | null {
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY; // one Foundry account, one key
  if (!endpoint || !key) return null;
  return {
    url: new URL(`contentsafety/text:analyze?api-version=${API_VERSION}`, endpoint).toString(),
    key,
  };
}

/** Analyze one text block; returns a verdict, never throws. */
export async function moderateText(text: string): Promise<ModerationVerdict> {
  const provider = aiProvider();
  if (provider === 'aws') return moderateTextWithGuardrail(text);
  if (provider === 'off') return { blocked: false };

  const cfg = config();
  if (!cfg || text.trim().length === 0) return { blocked: false };

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, MAX_ANALYZE_CHARS),
        outputType: 'FourSeverityLevels',
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`content safety analyze failed: HTTP ${res.status}`);
      return { blocked: false };
    }
    const body = (await res.json()) as { categoriesAnalysis?: CategoryAnalysis[] };
    const worst = (body.categoriesAnalysis ?? []).reduce<CategoryAnalysis | null>(
      (acc, c) => (acc && acc.severity >= c.severity ? acc : c),
      null,
    );
    if (worst && worst.severity >= BLOCK_SEVERITY) {
      return { blocked: true, category: worst.category, severity: worst.severity };
    }
    return { blocked: false };
  } catch {
    console.warn('content safety analyze failed: network/timeout');
    return { blocked: false };
  }
}

/** Moderate several texts with bounded concurrency; first block wins. */
export async function moderateTexts(texts: string[]): Promise<ModerationVerdict> {
  const BATCH = 5;
  for (let i = 0; i < texts.length; i += BATCH) {
    const verdicts = await Promise.all(texts.slice(i, i + BATCH).map(moderateText));
    const hit = verdicts.find((v) => v.blocked);
    if (hit) return hit;
  }
  return { blocked: false };
}

/** Throw a user-safe error when the text violates the content policy. */
export async function assertTextSafe(text: string, label: string): Promise<void> {
  const verdict = await moderateText(text);
  if (verdict.blocked) {
    throw new Error(`${label} was blocked by the content policy (${verdict.category}).`);
  }
}

function imageConfig(): { url: string; key: string } | null {
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !key) return null;
  return {
    url: new URL(`contentsafety/image:analyze?api-version=${API_VERSION}`, endpoint).toString(),
    key,
  };
}

/**
 * Analyze an uploaded image (incident photo evidence). Same posture as text:
 * block at medium+ severity, fail open on service errors.
 */
export async function moderateImage(data: Uint8Array): Promise<ModerationVerdict> {
  const provider = aiProvider();
  if (provider === 'aws') return moderateImageWithGuardrail(data);
  if (provider === 'off') return { blocked: false };

  const cfg = imageConfig();
  if (!cfg || data.byteLength === 0) return { blocked: false };

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'content-type': 'application/json' },
      body: JSON.stringify({ image: { content: Buffer.from(data).toString('base64') } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`content safety image analyze failed: HTTP ${res.status}`);
      return { blocked: false };
    }
    const body = (await res.json()) as { categoriesAnalysis?: CategoryAnalysis[] };
    const worst = (body.categoriesAnalysis ?? []).reduce<CategoryAnalysis | null>(
      (acc, c) => (acc && acc.severity >= c.severity ? acc : c),
      null,
    );
    if (worst && worst.severity >= BLOCK_SEVERITY) {
      return { blocked: true, category: worst.category, severity: worst.severity };
    }
    return { blocked: false };
  } catch {
    console.warn('content safety image analyze failed: network/timeout');
    return { blocked: false };
  }
}
