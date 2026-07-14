import { z } from 'zod';
import { deleteSession } from '@horus/core/knowledge';
import { PLAYGROUND } from '../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SessionSchema = z.string().uuid();

export async function DELETE(req: Request) {
  const rate = checkRateLimit('ingest', clientIp(req), PLAYGROUND.rate.ingestPerHour);
  if (!rate.ok) return rateLimitResponse(rate);

  const sessionId = new URL(req.url).searchParams.get('sessionId');
  const parsed = SessionSchema.safeParse(sessionId);
  if (!parsed.success) {
    return Response.json({ error: 'sessionId query param must be a UUID' }, { status: 400 });
  }

  const deleted = await deleteSession(PLAYGROUND.indexName, PLAYGROUND.tenantId, parsed.data).catch(
    () => 0,
  );
  return Response.json({ deleted });
}
