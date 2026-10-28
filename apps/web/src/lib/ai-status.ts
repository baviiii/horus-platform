import { AiUnavailableError, aiProvider, isAiUnavailable } from '@horus/core/provider';

/**
 * Early exit for AI routes while HORUS_AI_PROVIDER=off. Answering 503 before
 * any work (or any SSE stream) starts lets callers like CareerCraft show a
 * "temporarily unavailable" state instead of parsing a failed 200 stream.
 */
export function aiOffResponse(): Response | null {
  if (aiProvider() !== 'off') return null;
  return Response.json(
    { error: new AiUnavailableError().message, code: 'AI_UNAVAILABLE' },
    { status: 503, headers: { 'Retry-After': '3600' } },
  );
}

/** HTTP status for an error thrown by an AI call: 503 when switched off, else upstream failure. */
export function aiErrorStatus(err: unknown): number {
  return isAiUnavailable(err) ? 503 : 502;
}

/**
 * Realtime voice runs only on Azure (WebRTC straight to the model). On AWS it
 * needs a relay server that doesn't exist yet, so the session routes answer
 * 503 rather than minting against an Azure endpoint that may be gone.
 */
export function voiceUnavailableResponse(): Response | null {
  if (aiProvider() === 'azure') return null;
  return Response.json(
    { error: 'Voice is not available on this deployment yet.', code: 'VOICE_UNAVAILABLE' },
    { status: 503 },
  );
}
