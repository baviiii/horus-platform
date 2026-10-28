import { z } from 'zod';
import { prisma } from '@horus/db';
import { runKnowledgeAgent, type AgentEvent } from '@horus/core/agent';
import { ensureKnowledgeIndex } from '@horus/core/knowledge';
import { moderateText } from '@horus/core/safety';
import type { McpServerRef } from '@horus/core/mcp';
import { getCurrentUser } from '@/lib/supabase/server';
import { sseResponse } from '../../playground/_lib/sse';
import { aiOffResponse } from '@/lib/ai-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Workspace agent chat — the same engine as the playground, but authed,
 * tenant-scoped, and persistent:
 *  - knowledge lives in the tenant's partition (sessionId "workspace")
 *  - the tenant's registered MCP connections attach as tools
 *  - every turn is stored as ChatSession/ChatMessage rows
 */

const WORKSPACE_PARTITION = 'workspace';
const HISTORY_TURNS = 16;

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

async function requireMember(slug: string) {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: 'Not signed in' }, { status: 401 }) };
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return { error: Response.json({ error: 'Unknown workspace' }, { status: 404 }) };
  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
  });
  if (!member) return { error: Response.json({ error: 'Not a member' }, { status: 403 }) };
  return { tenant, user };
}

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

const PostSchema = z.object({
  tenant: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
  model: z.enum(['fast', 'deep']).default('fast'),
  /** Optional agent slug — when present, the agent's persona + collection scope apply. */
  agent: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  const aiOff = aiOffResponse();
  if (aiOff) return aiOff;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { sessionId, message, model } = parsed.data;

  const auth = await requireMember(parsed.data.tenant);
  if ('error' in auth) return auth.error;
  const { tenant, user } = auth;

  // Resolve the agent (if any) — it shapes persona, partition, and session context.
  let agentRow: {
    id: string;
    name: string;
    slug: string;
    persona: string | null;
    collectionIds: string[];
    status: string;
  } | null = null;
  if (parsed.data.agent) {
    agentRow = await prisma.agent.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: parsed.data.agent } },
      select: {
        id: true,
        name: true,
        slug: true,
        persona: true,
        collectionIds: true,
        status: true,
      },
    });
    if (!agentRow || agentRow.status !== 'ACTIVE') {
      return Response.json({ error: 'Unknown or inactive agent' }, { status: 404 });
    }
  }
  // Partition: always "workspace" — the search index is one shared space.
  // Collection scoping happens via sourceIds filter, not partition switching.
  const partition = WORKSPACE_PARTITION;
  const sessionContext = agentRow ? `agent:${agentRow.slug}` : 'workspace-agent';

  // Resolve the agent's collections to document sourceIds for retrieval scoping.
  let scopedSourceIds: string[] | undefined;
  if (agentRow && agentRow.collectionIds.length > 0) {
    const docs = await prisma.document.findMany({
      where: { tenantId: tenant.id, collectionId: { in: agentRow.collectionIds } },
      select: { metadata: true },
    });
    const sourceIds = docs
      .map((d) => (d.metadata as { sourceId?: string })?.sourceId)
      .filter((id): id is string => typeof id === 'string');
    // Empty result means the collections have no documents — search nothing.
    scopedSourceIds = sourceIds.length > 0 ? sourceIds : ['__no_documents__'];
  }

  const verdict = await moderateText(message);
  if (verdict.blocked) {
    return Response.json(
      { error: `Message blocked by the content policy (${verdict.category}).` },
      { status: 400 },
    );
  }

  // Load-or-create the session, then persist the user turn before running.
  let session = sessionId
    ? await prisma.chatSession.findFirst({ where: { id: sessionId, tenantId: tenant.id } })
    : null;
  if (sessionId && !session) {
    return Response.json({ error: 'Unknown session' }, { status: 404 });
  }
  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        title: message.slice(0, 80),
        context: sessionContext,
      },
    });
  }
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: 'USER', content: message },
  });

  // Newest turns, then back into reading order — `asc` + `take` returned the
  // oldest turns, dropping the message just saved once a session ran long.
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
        sessionId: partition,
        messages: history.map((m) => ({
          role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
        model,
        ...(agentRow?.persona && { persona: agentRow.persona, personaName: agentRow.name }),
        ...(scopedSourceIds && { sourceIds: scopedSourceIds }),
        mcpServers,
        emit,
        signal: req.signal,
      });
    } finally {
      // Persist whatever the agent produced, even on mid-stream failure.
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
        await prisma.chatSession
          .update({ where: { id: sessionIdFinal }, data: { updatedAt: new Date() } })
          .catch(() => undefined);
      }
    }
  });
}

/** GET ?tenant=slug&sessionId=... — messages of one session for the chat UI. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('tenant') ?? '';
  const sessionId = url.searchParams.get('sessionId') ?? '';
  if (!slug || !sessionId) return Response.json({ error: 'Missing params' }, { status: 400 });

  const auth = await requireMember(slug);
  if ('error' in auth) return auth.error;

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, tenantId: auth.tenant.id },
  });
  if (!session) return Response.json({ error: 'Unknown session' }, { status: 404 });

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, sources: true, createdAt: true },
  });
  return Response.json({ messages });
}
