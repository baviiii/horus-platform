/**
 * Language models through the AI SDK, from any provider, so switching model —
 * or company — is a setting, not a code change.
 *
 * A model setting is `provider:modelId`:
 *   bedrock:au.anthropic.claude-sonnet-4-6   Amazon Bedrock (HORUS_AWS_* keys)
 *   openai:gpt-5                              OpenAI (OPENAI_API_KEY)
 *   anthropic:claude-sonnet-4-6               Anthropic (ANTHROPIC_API_KEY)
 *   google:gemini-2.5-pro                     Google (GOOGLE_GENERATIVE_AI_API_KEY)
 * A setting without a known prefix is a Bedrock model ID, so plain IDs such
 * as `minimax.minimax-m2.5` keep working.
 *
 * Bedrock notes: in Sydney the current Claude models are only invocable
 * through an inference profile (`au.` keeps inference in Australia), and
 * every Bedrock model used also needs bedrock:InvokeModel on its ARN in the
 * app's IAM policy (infrastructure/tofu/envs/aws-dev/iam.tf).
 */
import { createAmazonBedrock, type AmazonBedrockProvider } from '@ai-sdk/amazon-bedrock';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { LanguageModel } from 'ai';
import { awsCredentials, awsRegion } from './aws.js';

/** fast/deep are the capability tiers callers ask for; vision reads images. */
export type ModelTier = 'fast' | 'deep' | 'vision';

const DEFAULT_MODEL = 'bedrock:au.anthropic.claude-sonnet-4-6';

const PROVIDERS = ['bedrock', 'openai', 'anthropic', 'google'] as const;
type ProviderName = (typeof PROVIDERS)[number];

/**
 * HORUS_MODEL_* picks the model per tier. The HORUS_CLAUDE_MODEL_* names are
 * the earlier Claude-only settings and still work. Vision defaults to Claude
 * rather than the fast tier, because not every text model reads images.
 */
export function modelSetting(tier: ModelTier): string {
  const env = process.env;
  if (tier === 'vision') return env.HORUS_MODEL_VISION || DEFAULT_MODEL;
  if (tier === 'deep') return env.HORUS_MODEL_DEEP || env.HORUS_CLAUDE_MODEL_DEEP || DEFAULT_MODEL;
  return env.HORUS_MODEL_FAST || env.HORUS_CLAUDE_MODEL_FAST || DEFAULT_MODEL;
}

/** Splits `provider:modelId`. Bedrock IDs contain colons too (`…-v1:0`), so only a known prefix counts. */
export function parseModel(setting: string): { provider: ProviderName; id: string } {
  const colon = setting.indexOf(':');
  const prefix = colon > -1 ? setting.slice(0, colon) : '';
  if ((PROVIDERS as readonly string[]).includes(prefix)) {
    return { provider: prefix as ProviderName, id: setting.slice(colon + 1) };
  }
  return { provider: 'bedrock', id: setting };
}

/** The model ID that serves a tier, as reported in results and logs. */
export function modelId(tier: ModelTier): string {
  return parseModel(modelSetting(tier)).id;
}

/**
 * Bedrock prompt caching is offered for Claude and Nova; other Bedrock models
 * reject a cache point, so it is only attached for these families.
 */
export function supportsCachePoint(tier: ModelTier): boolean {
  const { provider, id } = parseModel(modelSetting(tier));
  return provider === 'bedrock' && /anthropic\.claude|amazon\.nova/.test(id);
}

let bedrockProvider: AmazonBedrockProvider | null = null;

function bedrock(): AmazonBedrockProvider {
  if (bedrockProvider) return bedrockProvider;
  const region = awsRegion();
  const credentials = awsCredentials();
  if (credentials) {
    bedrockProvider = createAmazonBedrock({
      region,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken && { sessionToken: credentials.sessionToken }),
    });
  } else {
    // No explicit keys (local dev): the AWS SDK's default chain, e.g. an
    // `aws sso login` profile, borrowed from a client that already resolves it.
    const chain = new BedrockRuntimeClient({ region }).config.credentials;
    bedrockProvider = createAmazonBedrock({
      region,
      credentialProvider: async () => {
        const c = await chain();
        return {
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          ...(c.sessionToken && { sessionToken: c.sessionToken }),
        };
      },
    });
  }
  return bedrockProvider;
}

export function languageModel(tier: ModelTier): LanguageModel {
  const { provider, id } = parseModel(modelSetting(tier));
  switch (provider) {
    case 'openai':
      return openai(id);
    case 'anthropic':
      return anthropic(id);
    case 'google':
      return google(id);
    default:
      return bedrock()(id);
  }
}
