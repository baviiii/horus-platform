import { z } from 'zod';
import {
  blockedUrlReason,
  countSessionChunks,
  ingestUrl,
  listSessionSources,
  purgeExpired,
} from '@horus/core/knowledge';
import { PLAYGROUND } from '../../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';
import { sseResponse } from '../../_lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  url: z.string().url().max(2048),
});

// Opportunistic TTL sweep — at most once per half hour per instance.
let lastSweep = 0;
function sweepExpired(): void {
  const now = Date.now();
  if (now - lastSweep < 30 * 60 * 1000) return;
  lastSweep = now;
  purgeExpired(PLAYGROUND.indexName, PLAYGROUND.tenantId, PLAYGROUND.sessionTtlHours).catch(
    () => undefined,
  );
}

export async function POST(req: Request) {
  const rate = checkRateLimit('ingest', clientIp(req), PLAYGROUND.rate.ingestPerHour);
  if (!rate.ok) return rateLimitResponse(rate);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sessionId, url } = parsed.data;

  const blocked = blockedUrlReason(url);
  if (blocked) return Response.json({ error: blocked }, { status: 400 });

  // Session quotas — checked before the expensive work starts.
  const [sources, chunkCount] = await Promise.all([
    listSessionSources(PLAYGROUND.indexName, PLAYGROUND.tenantId, sessionId).catch(() => []),
    countSessionChunks(PLAYGROUND.indexName, PLAYGROUND.tenantId, sessionId).catch(() => 0),
  ]);
  if (sources.length >= PLAYGROUND.maxSourcesPerSession) {
    return Response.json(
      {
        error: `Session source limit reached (${PLAYGROUND.maxSourcesPerSession}). Reset the session to start over.`,
      },
      { status: 400 },
    );
  }
  if (chunkCount >= PLAYGROUND.maxChunksPerSession) {
    return Response.json(
      { error: 'Session knowledge limit reached. Reset the session to start over.' },
      { status: 400 },
    );
  }

  sweepExpired();

  return sseResponse(async (send) => {
    await ingestUrl({
      indexName: PLAYGROUND.indexName,
      tenantId: PLAYGROUND.tenantId,
      sessionId,
      url,
      maxPages: PLAYGROUND.maxPagesPerCrawl,
      maxChunks: Math.min(
        PLAYGROUND.maxChunksPerIngest,
        PLAYGROUND.maxChunksPerSession - chunkCount,
      ),
      emit: send,
    });
  });
}
