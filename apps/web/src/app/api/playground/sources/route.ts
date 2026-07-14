import { z } from 'zod';
import { listSessionSources } from '@horus/core/knowledge';
import { PLAYGROUND } from '../_lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SessionSchema = z.string().uuid();

export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  const parsed = SessionSchema.safeParse(sessionId);
  if (!parsed.success) {
    return Response.json({ error: 'sessionId query param must be a UUID' }, { status: 400 });
  }

  // A session that never ingested anything has no index yet — that's just "empty".
  const sources = await listSessionSources(
    PLAYGROUND.indexName,
    PLAYGROUND.tenantId,
    parsed.data,
  ).catch(() => []);

  return Response.json({
    sources,
    limits: {
      maxSources: PLAYGROUND.maxSourcesPerSession,
      maxPagesPerCrawl: PLAYGROUND.maxPagesPerCrawl,
      maxPdfMb: Math.round(PLAYGROUND.maxPdfBytes / 1024 / 1024),
      sessionTtlHours: PLAYGROUND.sessionTtlHours,
    },
  });
}
