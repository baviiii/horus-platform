/**
 * Claude on Amazon Bedrock, through the classic runtime endpoint
 * (`bedrock-runtime`, InvokeModel). Same request shape as Anthropic's
 * first-party API.
 *
 * Not the newer Messages-API endpoint (`bedrock-mantle`): in ap-southeast-2 it
 * answers 404 "model does not exist" for every Claude model on this account,
 * including ones bedrock-runtime serves (checked 2026-10-29).
 *
 * Model IDs are inference profiles. In Sydney the current Claude models are
 * only invocable through one: `au.` keeps inference in Australia, `global.`
 * may route anywhere.
 */
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { betaRefusalFallbackMiddleware } from '@anthropic-ai/sdk';
import { awsCredentials, awsRegion } from './aws.js';

export type ClaudeTier = 'fast' | 'deep';

/**
 * Both tiers default to Claude Sonnet 4.6 in Australia. Sonnet 5 and Opus 5
 * are not available to this account yet. `HORUS_CLAUDE_MODEL_FAST` can go to
 * `au.anthropic.claude-haiku-4-5-20251001-v1:0` to trade quality for credits
 * on the high-volume routes.
 */
const DEFAULT_MODEL = 'au.anthropic.claude-sonnet-4-6';

export function claudeModel(tier: ClaudeTier): string {
  if (tier === 'deep') return process.env.HORUS_CLAUDE_MODEL_DEEP || DEFAULT_MODEL;
  return process.env.HORUS_CLAUDE_MODEL_FAST || DEFAULT_MODEL;
}

/**
 * Model that re-serves a request Claude declines on policy grounds. Bedrock
 * has no server-side `fallbacks` parameter, so the SDK middleware retries
 * client-side. Off unless HORUS_CLAUDE_FALLBACK_MODEL names a model.
 */
function fallbackModel(): string | null {
  const value = process.env.HORUS_CLAUDE_FALLBACK_MODEL;
  return value && value !== 'none' ? value : null;
}

/** Haiku 4.5 runs on Bedrock's older serving stack, which rejects the field. */
export function supportsEagerInputStreaming(model: string): boolean {
  return !model.includes('haiku-4-5');
}

/**
 * Opus 5.5, Fable 5.1 and Mythos 5.1 reject forced `tool_choice` and cannot
 * disable thinking; JSON output on those models goes through `auto`.
 */
export function supportsForcedToolChoice(model: string): boolean {
  return !/opus-5-5|fable-5-1|mythos-5-1/.test(model);
}

let cached: AnthropicBedrock | null = null;

export function getClaudeClient(): AnthropicBedrock {
  if (cached) return cached;
  const credentials = awsCredentials();
  const fallback = fallbackModel();
  const options = {
    awsRegion: awsRegion(),
    ...(fallback && { middleware: [betaRefusalFallbackMiddleware([{ model: fallback }])] }),
  };
  // Without explicit keys the client uses the default AWS chain (local dev).
  cached = credentials
    ? new AnthropicBedrock({
        ...options,
        awsAccessKey: credentials.accessKeyId,
        awsSecretKey: credentials.secretAccessKey,
        awsSessionToken: credentials.sessionToken ?? null,
      })
    : new AnthropicBedrock(options);
  return cached;
}
