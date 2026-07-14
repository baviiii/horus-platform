import { z } from 'zod';
import { CitationRegistry, executeFetchPage, executeSearchKnowledge } from '@horus/core/agent';
import { PLAYGROUND } from '../../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  name: z.enum(['search_knowledge', 'fetch_page']),
  args: z.record(z.unknown()).default({}),
});

/**
 * Tool bridge for realtime voice: the browser receives function_call events
 * on the WebRTC data channel and forwards them here, where the same
 * executors that back the chat agent run with server-side credentials.
 */
export async function POST(req: Request) {
  const rate = checkRateLimit('voice-tool', clientIp(req), PLAYGROUND.rate.chatPerHour);
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
  const { sessionId, name, args } = parsed.data;

  const registry = new CitationRegistry();
  let output: string;
  if (name === 'search_knowledge' && typeof args.query === 'string') {
    output = await executeSearchKnowledge(
      {
        indexName: PLAYGROUND.indexName,
        tenantId: PLAYGROUND.tenantId,
        sessionId,
        topK: PLAYGROUND.topK,
      },
      registry,
      args.query,
    );
  } else if (name === 'fetch_page' && typeof args.url === 'string') {
    output = await executeFetchPage(registry, args.url);
  } else {
    output = `Invalid arguments for "${name}".`;
  }

  return Response.json({ output, citations: registry.all() });
}
