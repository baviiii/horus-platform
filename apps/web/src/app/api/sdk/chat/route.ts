import { z } from 'zod';
import { prisma } from '@horus/db';
import { validateApiKey, hasAllScopes } from '@horus/auth';
import { runKnowledgeAgent, type AgentEvent } from '@horus/core/agent';
import { ensureKnowledgeIndex } from '@horus/core/knowledge';
import { moderateText } from '@horus/core/safety';
import type { McpServerRef } from '@horus/core/mcp';
import { sseResponse } from '../../playground/_lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Streaming chat for SDK consumers.
 *
 * Same agent engine as the dashboard's `/api/agent/chat`, but the tenant is
 * resolved from an **API key** rather than a Supabase session cookie — which
 * is what makes it reachable from another application. The dashboard route
 * stays cookie-authed; this one exists so an external app (CareerCraft) can
 * hold a scoped key and converse with its own corpus.
 *
 * Auth: `Authorization: Bearer horus_sk_...`, requiring the `rag:read` scope.
 */

const WORKSPACE_PARTITION = 'workspace';
const HISTORY_TURNS = 8;

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

const PostSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
  model: z.enum(['fast', 'deep']).default('fast'),
  // The consumer's voice for this conversation. It sets tone, audience and
  // format; the grounding and citation rules stay Horus's and come first.
  persona: z.string().max(8000).optional(),
  personaName: z.string().max(80).optional(),
});

/**
 * Passages per search_knowledge call. The agent default is 8; on the
 * CareerCraft corpus 10 missed the passage that stated the answer, which is
 * why rag.query uses 16 (docs/CAREERCRAFT-INTEGRATION.md §5.4). Same corpus,
 * same floor.
 */
const SEARCH_TOP_K = 16;

/** Tenant MCP connections attach as agent tools, same as the dashboard agent. */
async function tenantMcpServers(tenantId: string): Promise<McpServerRef[]> {
  const rows = await prisma.connection.findMany({
    where: { tenantId, kind: 'MCP', status: { not: 'DISABLED' } },
  });
  return rows.map((row) => {
    const secret =
      row.authType === 'bearer' && row.secretRef ? process.env[row.secretRef] : undefined;
    return {
      label: row.slug,
      url: row.endpoint,
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
    };
  });
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth) {
    return Response.json({ error: 'Missing Authorization header' }, { status: 401 });
  }
  const validated = await validateApiKey(auth.replace(/^Bearer\s+/i, '').trim());
  if (!validated) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }
  if (!hasAllScopes(validated.scopes, ['rag:read'])) {
    return Response.json({ error: 'API key is missing the rag:read scope' }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: validated.tenantId } });
  if (!tenant || !tenant.isActive) {
    return Response.json({ error: 'Tenant not found or inactive' }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { sessionId, message, model, personaName } = parsed.data;
  const persona = parsed.data.persona?.trim() || undefined;

  const verdict = await moderateText(message);
  if (verdict.blocked) {
    return Response.json(
      { error: `Message blocked by the content policy (${verdict.category}).` },
      { status: 400 },
    );
  }

  // Sessions are scoped to the tenant AND the calling key, so one consumer
  // cannot resume another's conversation by guessing a session id.
  let session = sessionId
    ? await prisma.chatSession.findFirst({
        where: { id: sessionId, tenantId: tenant.id, apiKeyId: validated.apiKey.id },
      })
    : null;
  if (sessionId && !session) {
    return Response.json({ error: 'Unknown session' }, { status: 404 });
  }
  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        tenantId: tenant.id,
        apiKeyId: validated.apiKey.id,
        title: message.slice(0, 80),
        context: 'sdk-agent',
      },
    });
  }

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: 'USER', content: message },
  });

  // Newest turns, then back into reading order. This was `asc` + `take`, which
  // returns the OLDEST turns: from the ninth exchange on, the message just
  // saved above fell outside the window and the agent answered an old one.
  const history = (
    await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS * 2,
    })
  ).reverse();

  const [mcpServers] = await Promise.all([
    tenantMcpServers(tenant.id),
    ensureKnowledgeIndex(indexName()),
  ]);

  const startedAt = Date.now();
  const sessionIdFinal = session.id;
  const apiKeyId = validated.apiKey.id;

  await prisma.apiKey
    .update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return sseResponse(async (send) => {
    send({ kind: 'session', id: sessionIdFinal });

    let assistantText = '';
    let citations: unknown = null;
    let usage: { inputTokens: number; outputTokens: number } | null = null;

    const emit = (event: AgentEvent) => {
      if (event.kind === 'token') assistantText += event.text;
      if (event.kind === 'citations') citations = event.citations;
      if (event.kind === 'done') usage = event.usage;
      send(event);
    };

    try {
      await runKnowledgeAgent({
        indexName: indexName(),
        tenantId: tenant.id,
        sessionId: WORKSPACE_PARTITION,
        messages: history.map((m) => ({
          role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
        model,
        topK: SEARCH_TOP_K,
        ...(persona && { persona, personaName }),
        mcpServers,
        emit,
        signal: req.signal,
      });
    } finally {
      // Persist whatever was produced, even if the stream broke mid-flight.
      if (assistantText.trim()) {
        const finalUsage = usage as { inputTokens: number; outputTokens: number } | null;
        await prisma.chatMessage
          .create({
            data: {
              sessionId: sessionIdFinal,
              role: 'ASSISTANT',
              content: assistantText,
              sources: citations ? JSON.parse(JSON.stringify(citations)) : undefined,
              tokensIn: finalUsage?.inputTokens,
              tokensOut: finalUsage?.outputTokens,
              latencyMs: Date.now() - startedAt,
              modelUsed: model,
            },
          })
          .catch(() => undefined);

        if (finalUsage) {
          await prisma.usageRecord
            .createMany({
              data: [
                {
                  tenantId: tenant.id,
                  apiKeyId,
                  meter: 'COMPLETION_TOKENS_IN',
                  quantity: BigInt(finalUsage.inputTokens),
                  metadata: { task: 'sdk.chat' },
                },
                {
                  tenantId: tenant.id,
                  apiKeyId,
                  meter: 'COMPLETION_TOKENS_OUT',
                  quantity: BigInt(finalUsage.outputTokens),
                  metadata: { task: 'sdk.chat' },
                },
              ],
            })
            .catch(() => undefined);
        }
      }
    }
  });
}
