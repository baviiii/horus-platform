import { z } from 'zod';
import { ensureKnowledgeIndex } from '@horus/core/knowledge';
import { runKnowledgeAgent } from '@horus/core/agent';
import { moderateText } from '@horus/core/safety';
import { PLAYGROUND } from '../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../_lib/rate-limit';
import { sseResponse } from '../_lib/sse';
import { aiOffResponse } from '@/lib/ai-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  model: z.enum(['fast', 'deep']).default('fast'),
});

export async function POST(req: Request) {
  const aiOff = aiOffResponse();
  if (aiOff) return aiOff;

  const rate = checkRateLimit('chat', clientIp(req), PLAYGROUND.rate.chatPerHour);
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
  const { sessionId, messages, model } = parsed.data;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser) {
    const verdict = await moderateText(lastUser.content);
    if (verdict.blocked) {
      return Response.json(
        { error: `Message blocked by the content policy (${verdict.category}).` },
        { status: 400 },
      );
    }
  }

  // Searching a not-yet-created index 404s — make sure it exists even for
  // sessions that chat before connecting any knowledge.
  await ensureKnowledgeIndex(PLAYGROUND.indexName);

  return sseResponse(async (send) => {
    await runKnowledgeAgent({
      indexName: PLAYGROUND.indexName,
      tenantId: PLAYGROUND.tenantId,
      sessionId,
      messages: messages.slice(-16), // bound prompt size; client keeps full history
      model,
      topK: PLAYGROUND.topK,
      mcpServers: PLAYGROUND.mcpServers,
      emit: send,
      signal: req.signal,
    });
  });
}
