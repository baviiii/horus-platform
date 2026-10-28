/**
 * Which cloud serves Horus's AI: models, embeddings, the knowledge store,
 * moderation and PII detection all dispatch on this one switch.
 *
 * - `azure` (default): Foundry Agent Service, Azure OpenAI, AI Search.
 * - `aws`: Claude on Bedrock, Titan embeddings, S3 Vectors, Guardrails.
 * - `off`: every AI entry point fails fast with AiUnavailableError, which
 *   routes turn into a 503. This is the kill switch for when the configured
 *   cloud is gone; without it callers get DNS failures and opaque 500s.
 *
 * Read per call rather than at import so a test or script can flip it.
 */
export type AiProvider = 'azure' | 'aws' | 'off';

export function aiProvider(): AiProvider {
  const value = (process.env.HORUS_AI_PROVIDER ?? 'azure').trim().toLowerCase();
  return value === 'aws' || value === 'off' ? value : 'azure';
}

export class AiUnavailableError extends Error {
  readonly code = 'AI_UNAVAILABLE';

  constructor(message = 'AI features are temporarily unavailable. Please try again later.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/**
 * True for AiUnavailableError, including one that crossed a package boundary
 * as a different class instance (bundlers can duplicate this module).
 */
export function isAiUnavailable(err: unknown): err is AiUnavailableError {
  return (
    err instanceof AiUnavailableError || (err instanceof Error && err.name === 'AiUnavailableError')
  );
}

export function assertAiAvailable(): void {
  if (aiProvider() === 'off') throw new AiUnavailableError();
}
