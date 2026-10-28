/**
 * Claude on Amazon Bedrock, through the Messages-API endpoint
 * (`bedrock-mantle.{region}.api.aws/anthropic`). Same request shape as
 * Anthropic's first-party API; model IDs carry an `anthropic.` prefix.
 */
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { betaRefusalFallbackMiddleware } from '@anthropic-ai/sdk';
import { awsCredentials, awsRegion } from './aws.js';

export type ClaudeTier = 'fast' | 'deep';

/**
 * Both tiers default to Claude Opus 5. Point `HORUS_CLAUDE_MODEL_FAST` at
 * `anthropic.claude-sonnet-5` or `anthropic.claude-haiku-4-5` to trade
 * quality for credits on the high-volume routes.
 */
export function claudeModel(tier: ClaudeTier): string {
  if (tier === 'deep') return process.env.HORUS_CLAUDE_MODEL_DEEP || 'anthropic.claude-opus-5';
  return process.env.HORUS_CLAUDE_MODEL_FAST || 'anthropic.claude-opus-5';
}

/**
 * Model that re-serves a request Claude declines on policy grounds. Bedrock
 * has no server-side `fallbacks` parameter, so the SDK middleware retries
 * client-side. Set HORUS_CLAUDE_FALLBACK_MODEL=none to disable.
 */
function fallbackModel(): string | null {
  const value = process.env.HORUS_CLAUDE_FALLBACK_MODEL ?? 'anthropic.claude-opus-4-8';
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

let cached: AnthropicBedrockMantle | null = null;

export function getClaudeClient(): AnthropicBedrockMantle {
  if (cached) return cached;
  const credentials = awsCredentials();
  const fallback = fallbackModel();
  cached = new AnthropicBedrockMantle({
    awsRegion: awsRegion(),
    ...(credentials && {
      awsAccessKey: credentials.accessKeyId,
      awsSecretAccessKey: credentials.secretAccessKey,
      awsSessionToken: credentials.sessionToken ?? null,
    }),
    ...(fallback && { middleware: [betaRefusalFallbackMiddleware([{ model: fallback }])] }),
  });
  return cached;
}
