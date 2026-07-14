import { z } from 'zod';
import { buildVoiceSessionConfig } from '@horus/core/agent';
import { PLAYGROUND } from '../../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  sessionId: z.string().uuid(),
});

/**
 * Mints an ephemeral realtime key (GA `/openai/v1/realtime/client_secrets`).
 * The full session — model, voice, instructions with the session's connected
 * sources, function tools — is configured here server-side; the browser only
 * receives the short-lived key and the WebRTC endpoint.
 */
export async function POST(req: Request) {
  const rate = checkRateLimit('voice', clientIp(req), PLAYGROUND.rate.voicePerHour);
  if (!rate.ok) return rateLimitResponse(rate);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT;
  if (!endpoint || !apiKey || !deployment) {
    return Response.json({ error: 'Voice is not configured on this deployment' }, { status: 503 });
  }

  const session = await buildVoiceSessionConfig(
    {
      indexName: PLAYGROUND.indexName,
      tenantId: PLAYGROUND.tenantId,
      sessionId: parsed.data.sessionId,
    },
    deployment,
  );

  const mintRes = await fetch(new URL('openai/v1/realtime/client_secrets', endpoint), {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ session }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!mintRes.ok) {
    const detail = await mintRes.text().catch(() => '');
    console.error(`realtime client_secrets failed: HTTP ${mintRes.status} ${detail.slice(0, 500)}`);
    return Response.json({ error: 'Could not start a voice session' }, { status: 502 });
  }

  const minted = (await mintRes.json()) as { value?: string; expires_at?: number };
  if (!minted.value) {
    return Response.json({ error: 'Could not start a voice session' }, { status: 502 });
  }

  return Response.json({
    ephemeralKey: minted.value,
    webrtcUrl: new URL('openai/v1/realtime/calls?webrtcfilter=on', endpoint).toString(),
  });
}
