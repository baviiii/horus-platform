/**
 * Language models on Amazon Bedrock through the AI SDK (Bedrock's Converse
 * API), so any Bedrock model — Claude, Kimi, DeepSeek, Mistral, Nova,
 * gpt-oss — is a setting, not a code change.
 *
 * Model IDs are what Bedrock invokes. In Sydney the current Claude models are
 * only invocable through an inference profile: `au.` keeps inference in
 * Australia, `global.` may route anywhere. Every model used here also needs
 * bedrock:InvokeModel on its ARN in the app's IAM policy
 * (infrastructure/tofu/envs/aws-dev/iam.tf).
 */
import { createAmazonBedrock, type AmazonBedrockProvider } from '@ai-sdk/amazon-bedrock';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { LanguageModel } from 'ai';
import { awsCredentials, awsRegion } from './aws.js';

/** fast/deep are the capability tiers callers ask for; vision reads images. */
export type ModelTier = 'fast' | 'deep' | 'vision';

const DEFAULT_MODEL = 'au.anthropic.claude-sonnet-4-6';

/**
 * HORUS_MODEL_* picks the model per tier. The HORUS_CLAUDE_MODEL_* names are
 * the earlier Claude-only settings and still work. Vision defaults to Claude
 * rather than the fast tier, because not every text model reads images.
 */
export function modelId(tier: ModelTier): string {
  const env = process.env;
  if (tier === 'vision') return env.HORUS_MODEL_VISION || DEFAULT_MODEL;
  if (tier === 'deep') return env.HORUS_MODEL_DEEP || env.HORUS_CLAUDE_MODEL_DEEP || DEFAULT_MODEL;
  return env.HORUS_MODEL_FAST || env.HORUS_CLAUDE_MODEL_FAST || DEFAULT_MODEL;
}

/**
 * Bedrock prompt caching is offered for Claude and Nova; other models reject
 * a cache point, so it is only attached for these families.
 */
export function supportsCachePoint(id: string): boolean {
  return /anthropic\.claude|amazon\.nova/.test(id);
}

let provider: AmazonBedrockProvider | null = null;

function bedrock(): AmazonBedrockProvider {
  if (provider) return provider;
  const region = awsRegion();
  const credentials = awsCredentials();
  if (credentials) {
    provider = createAmazonBedrock({
      region,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken && { sessionToken: credentials.sessionToken }),
    });
  } else {
    // No explicit keys (local dev): the AWS SDK's default chain, e.g. an
    // `aws sso login` profile, borrowed from a client that already resolves it.
    const chain = new BedrockRuntimeClient({ region }).config.credentials;
    provider = createAmazonBedrock({
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
  return provider;
}

export function languageModel(tier: ModelTier): LanguageModel {
  return bedrock()(modelId(tier));
}
