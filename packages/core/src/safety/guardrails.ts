/**
 * Moderation on AWS via Bedrock Guardrails' ApplyGuardrail API — the
 * counterpart of the Azure Content Safety calls in `content-safety.ts`.
 *
 * The guardrail itself (created by infrastructure) holds the policy: harm
 * filters at MEDIUM strength, which blocks medium and high confidence and so
 * matches Azure's severity ≥ 4 rule. Same posture as Azure: no guardrail
 * configured means nothing is blocked, and service errors fail open.
 */
import { ApplyGuardrailCommand, type GuardrailContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { AWS_RESOURCES, getBedrockRuntimeClient } from '../clients/aws.js';
import type { ModerationVerdict } from './content-safety.js';

const MAX_ANALYZE_CHARS = 10_000;

/** Guardrail filter names in the casing Azure's categories used. */
const CATEGORY: Record<string, string> = {
  HATE: 'Hate',
  INSULTS: 'Insults',
  MISCONDUCT: 'Misconduct',
  PROMPT_ATTACK: 'PromptAttack',
  SEXUAL: 'Sexual',
  VIOLENCE: 'Violence',
};

/** Guardrail confidence on Azure's FourSeverityLevels scale. */
const SEVERITY: Record<string, number> = { NONE: 0, LOW: 2, MEDIUM: 4, HIGH: 6 };

async function applyGuardrail(content: GuardrailContentBlock[]): Promise<ModerationVerdict> {
  const guardrailIdentifier = AWS_RESOURCES.guardrailId();
  if (!guardrailIdentifier) return { blocked: false };

  try {
    const res = await getBedrockRuntimeClient().send(
      new ApplyGuardrailCommand({
        guardrailIdentifier,
        guardrailVersion: AWS_RESOURCES.guardrailVersion(),
        source: 'INPUT',
        content,
      }),
      { abortSignal: AbortSignal.timeout(8_000) },
    );
    if (res.action !== 'GUARDRAIL_INTERVENED') return { blocked: false };

    const blocking = (res.assessments ?? [])
      .flatMap((a) => a.contentPolicy?.filters ?? [])
      .filter((f) => f.action === 'BLOCKED')
      .sort(
        (a, b) => (SEVERITY[b.confidence ?? 'NONE'] ?? 0) - (SEVERITY[a.confidence ?? 'NONE'] ?? 0),
      );
    const worst = blocking[0];
    return {
      blocked: true,
      category: worst?.type ? (CATEGORY[worst.type] ?? worst.type) : 'Policy',
      ...(worst?.confidence && { severity: SEVERITY[worst.confidence] }),
    };
  } catch {
    console.warn('guardrail apply failed: network/timeout/service error');
    return { blocked: false };
  }
}

export function moderateTextWithGuardrail(text: string): Promise<ModerationVerdict> {
  if (text.trim().length === 0) return Promise.resolve({ blocked: false });
  return applyGuardrail([{ text: { text: text.slice(0, MAX_ANALYZE_CHARS) } }]);
}

/** Guardrails read PNG and JPEG only; other formats pass unscreened, as on Azure outages. */
export function moderateImageWithGuardrail(data: Uint8Array): Promise<ModerationVerdict> {
  if (data.byteLength === 0) return Promise.resolve({ blocked: false });
  const isPng = data[0] === 0x89 && data[1] === 0x50;
  const isJpeg = data[0] === 0xff && data[1] === 0xd8;
  if (!isPng && !isJpeg) return Promise.resolve({ blocked: false });
  return applyGuardrail([{ image: { format: isPng ? 'png' : 'jpeg', source: { bytes: data } } }]);
}
