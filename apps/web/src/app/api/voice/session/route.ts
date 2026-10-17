import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasAllScopes, SCOPES } from '@horus/auth';
import { buildListenSessionConfig } from '@horus/core/agent';
import { checkRateLimit } from '../../playground/_lib/rate-limit';

// bcryptjs (used by validateApiKey) needs Node, not the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/voice/session — a short-lived realtime key for one spoken answer.
 *
 * The playground's voice route is anonymous and IP-limited; this one is for
 * tenants. A service (the interview-coach MCP) calls it with its Horus API
 * key on behalf of one signed-in end user (`userRef`), and gets back an
 * ephemeral key plus the WebRTC endpoint. The browser connects with those
 * directly, so audio never passes through Horus or the caller, and nobody
 * downstream holds the Azure key.
 *
 * Listen-only: the session transcribes and never replies on its own
 * (see buildListenSessionConfig).
 */

const BodySchema = z.object({
  purpose: z.literal('interview_answer'),
  /** The caller's end user, for per-user limits. Opaque to Horus. */
  userRef: z.string().min(1).max(200),
});

/** Every session is paid audio; this is per end user, per hour, per tenant. */
const SESSIONS_PER_USER_PER_HOUR = 40;

function readKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
  const fn = req.headers.get('x-functions-key');
  return fn ? fn.trim() : null;
}

export async function POST(req: Request) {
  const token = readKey(req);
  if (!token) return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  const auth = await validateApiKey(token);
  if (!auth) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
    return NextResponse.json(
      { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const rate = checkRateLimit(
    'tenant-voice',
    `${auth.tenantId}:${parsed.data.userRef}`,
    SESSIONS_PER_USER_PER_HOUR,
  );
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many voice sessions — try again later' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT;
  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json(
      { error: 'Voice is not configured on this deployment' },
      { status: 503 },
    );
  }

  const mintRes = await fetch(new URL('openai/v1/realtime/client_secrets', endpoint), {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ session: buildListenSessionConfig(deployment) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!mintRes?.ok) {
    const detail = mintRes ? await mintRes.text().catch(() => '') : 'no response';
    console.error(
      `tenant voice client_secrets failed: HTTP ${mintRes?.status ?? '-'} ${detail.slice(0, 500)}`,
    );
    return NextResponse.json({ error: 'Could not start a voice session' }, { status: 502 });
  }

  const minted = (await mintRes.json()) as { value?: string; expires_at?: number };
  if (!minted.value) {
    return NextResponse.json({ error: 'Could not start a voice session' }, { status: 502 });
  }

  return NextResponse.json({
    ephemeralKey: minted.value,
    webrtcUrl: new URL('openai/v1/realtime/calls?webrtcfilter=on', endpoint).toString(),
    expiresAt: minted.expires_at,
  });
}
