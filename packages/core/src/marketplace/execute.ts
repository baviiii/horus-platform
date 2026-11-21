/**
 * Execution engine for Horus Marketplace targets (Indexes & MCP servers).
 *
 * Shared across:
 *   1. `/api/mcp/[slug]` (MCP Streamable HTTP server & gateway)
 *   2. `/api/v1/marketplace/[slug]/query` (REST v1 API for external platforms)
 *   3. Workspace & SDK Chat agents (for installed marketplace add-ons)
 *
 * Every query runs Horus content moderation, enforces strict collection/tenant
 * boundaries, and records usage meters against the *calling* tenant & API key.
 */
import { prisma } from '@horus/db';
import { infer } from '../inference/infer.js';
import { embedQuery } from '../knowledge/embeddings.js';
import { publicSourceUrl } from '../knowledge/public-links.js';
import { ensureKnowledgeIndex, searchKnowledge } from '../knowledge/store.js';
import { callMcpTool, listMcpTools } from '../mcp/client.js';
import { moderateText } from '../safety/content-safety.js';
import type { ResolvedMarketplaceTarget } from './catalog.js';

const WORKSPACE_PARTITION = 'workspace';

function activeIndexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

const ANSWER_SYSTEM = `You answer questions using ONLY the numbered passages provided.

Rules:
- Cite every factual claim inline as [n], using the passage numbers given.
- If the passages do not answer the question, say so plainly. Never fill the gap from general knowledge.
- Quote figures exactly as written; do not round, convert, or infer totals.

Return ONLY JSON: { "answer": string, "confidence": number between 0 and 1, "answered": boolean }

Put your complete response inside "answer" as one string, in whatever format was asked for — nothing outside "answer" is read.
"confidence" reflects how well the passages support the answer. "answered" is false when the passages simply don't cover the question.`;

const DEFAULT_STYLE = `Be direct. Lead with the answer, then the supporting detail.`;

export interface MarketplaceCaller {
  tenantId: string;
  tenantSlug: string;
  apiKeyId?: string | null;
  surface: 'mcp' | 'rest' | 'agent';
}

export class MarketplaceInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MarketplaceInputError';
    this.status = status;
  }
}

export interface IndexSearchHit {
  rank: number;
  score: number;
  title: string;
  excerpt: string;
  sourceId: string;
  chunkIx: number;
  sourceType: 'url' | 'pdf';
  sourceUrl?: string;
  pageNumber?: number;
}

async function recordUsage(
  caller: MarketplaceCaller,
  records: Array<{
    meter:
      | 'RAG_QUERIES'
      | 'GRAPH_QUERIES'
      | 'AGENTIC_QUERIES'
      | 'COMPLETION_TOKENS_IN'
      | 'COMPLETION_TOKENS_OUT';
    quantity: number;
  }>,
  listingSlug: string,
  op: string,
): Promise<void> {
  await prisma.usageRecord
    .createMany({
      data: records.map((r) => ({
        tenantId: caller.tenantId,
        ...(caller.apiKeyId && { apiKeyId: caller.apiKeyId }),
        meter: r.meter,
        quantity: BigInt(Math.max(0, Math.floor(r.quantity))),
        metadata: { marketplaceSlug: listingSlug, surface: caller.surface, op },
      })),
    })
    .catch(() => undefined);
}

export async function executeIndexSearch(
  target: Extract<ResolvedMarketplaceTarget, { kind: 'INDEX' }>,
  params: {
    query: string;
    topK?: number;
    category?: string;
    year?: number;
    tags?: string[];
  },
  caller: MarketplaceCaller,
): Promise<{ hits: IndexSearchHit[]; latencyMs: number }> {
  const startedAt = Date.now();
  const query = params.query.trim();
  if (!query || query.length > 4000) {
    throw new MarketplaceInputError('query must be between 1 and 4000 characters');
  }

  if (!target.targetTenantId) {
    return { hits: [], latencyMs: Date.now() - startedAt };
  }

  const verdict = await moderateText(query);
  if (verdict.blocked) {
    throw new MarketplaceInputError(
      `Query blocked by content policy (${verdict.category ?? 'safety'}).`,
      400,
    );
  }

  const top = Math.max(1, Math.min(20, Math.floor(params.topK ?? 8)));
  const idx = activeIndexName();
  await ensureKnowledgeIndex(idx);
  const vector = await embedQuery(query);

  const rawHits = await searchKnowledge({
    indexName: idx,
    tenantId: target.targetTenantId,
    sessionId: WORKSPACE_PARTITION,
    query,
    vector,
    top,
    filters: {
      ...(params.category && { category: params.category }),
      ...(params.year && { year: params.year }),
      ...(params.tags?.length && { tags: params.tags }),
      ...(target.sourceIds && { sourceIds: target.sourceIds }),
    },
  });

  await recordUsage(
    caller,
    [{ meter: 'RAG_QUERIES', quantity: 1 }],
    target.listing.slug,
    'search_index',
  );

  const hits: IndexSearchHit[] = rawHits.map((hit, i) => ({
    rank: i + 1,
    score: hit.score,
    title: hit.title,
    excerpt: hit.content.slice(0, 1200),
    sourceId: hit.sourceId,
    chunkIx: hit.chunkIx,
    sourceType: hit.sourceType,
    sourceUrl: publicSourceUrl(hit.sourceUrl),
    ...(hit.pageNumber !== undefined && { pageNumber: hit.pageNumber }),
  }));

  return { hits, latencyMs: Date.now() - startedAt };
}

export async function executeIndexAsk(
  target: Extract<ResolvedMarketplaceTarget, { kind: 'INDEX' }>,
  params: {
    query: string;
    maxSources?: number;
    category?: string;
    tags?: string[];
    systemPrompt?: string;
  },
  caller: MarketplaceCaller,
): Promise<{
  answer: string;
  confidence: number;
  answered: boolean;
  sources: Array<{
    n: number;
    id: string;
    title: string;
    excerpt: string;
    score: number;
    sourceUrl?: string;
    pageNumber?: number;
  }>;
  metadata: { tokensUsed: number; latencyMs: number; model: string };
}> {
  const startedAt = Date.now();
  const maxSources = Math.max(1, Math.min(16, Math.floor(params.maxSources ?? 10)));

  const { hits } = await executeIndexSearch(
    target,
    {
      query: params.query,
      topK: maxSources,
      category: params.category,
      tags: params.tags,
    },
    caller,
  );

  if (hits.length === 0) {
    return {
      answer:
        'Nothing in this knowledge index matches that question. Try broader search terms or inspect available categories.',
      confidence: 0,
      answered: false,
      sources: [],
      metadata: { tokensUsed: 0, latencyMs: Date.now() - startedAt, model: 'none' },
    };
  }

  const passages = hits.map((h) => `[${h.rank}] ${h.title}\n${h.excerpt}`).join('\n\n');

  const result = await infer({
    task: 'marketplace.ask',
    system: params.systemPrompt?.trim()
      ? `${params.systemPrompt.trim().slice(0, 2000)}\n\n${ANSWER_SYSTEM}`
      : `${DEFAULT_STYLE}\n\n${ANSWER_SYSTEM}`,
    messages: [{ role: 'user', content: `Question: ${params.query}\n\nPassages:\n${passages}` }],
    model: 'fast',
    temperature: 0.2,
    maxTokens: 1500,
    tenant: caller.tenantSlug,
  });

  let parsed: { answer?: unknown; confidence?: unknown; answered?: unknown } = {};
  try {
    parsed = JSON.parse(result.content) as typeof parsed;
  } catch {
    parsed = { answer: result.content, confidence: 0.5, answered: true };
  }

  await recordUsage(
    caller,
    [
      { meter: 'COMPLETION_TOKENS_IN', quantity: result.usage.inputTokens },
      { meter: 'COMPLETION_TOKENS_OUT', quantity: result.usage.outputTokens },
    ],
    target.listing.slug,
    'ask_index',
  );

  const answered = parsed.answered !== false;
  const confidence = !answered
    ? 0
    : typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    confidence,
    answered,
    sources: hits.map((h) => ({
      n: h.rank,
      id: `${h.sourceId}:${h.chunkIx}`,
      title: h.title,
      excerpt: h.excerpt.slice(0, 400),
      score: h.score,
      ...(h.sourceUrl && { sourceUrl: h.sourceUrl }),
      ...(h.pageNumber !== undefined && { pageNumber: h.pageNumber }),
    })),
    metadata: {
      tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      model: result.model,
    },
  };
}

export async function executeIndexGraphLookup(
  target: Extract<ResolvedMarketplaceTarget, { kind: 'INDEX' }>,
  params: { entity: string },
  caller: MarketplaceCaller,
): Promise<{
  found: boolean;
  entity?: {
    name: string;
    type: string;
    aliases: string[];
    attributes?: Record<string, unknown>;
  };
  outgoing: Array<{
    type: string;
    target: string;
    targetType: string;
    confidence: number;
    evidence?: string;
  }>;
  incoming: Array<{
    source: string;
    sourceType: string;
    type: string;
    confidence: number;
    evidence?: string;
  }>;
  documents: Array<{ id: string; title: string; category: string | null; mentions: number }>;
  summaryText: string;
}> {
  const name = params.entity.trim().slice(0, 120);
  if (!name) {
    throw new MarketplaceInputError('entity name is required');
  }
  if (!target.targetTenantId) {
    return {
      found: false,
      outgoing: [],
      incoming: [],
      documents: [],
      summaryText: `No knowledge graph is populated for "${target.listing.name}" yet.`,
    };
  }

  // If listing is scoped to a single KnowledgeCollection, ONLY expose entities
  // mentioned in that collection's indexed documents.
  const collectionFilter = target.documentIds
    ? { documents: { some: { documentId: { in: target.documentIds } } } }
    : {};

  const entity =
    (await prisma.entity.findFirst({
      where: {
        tenantId: target.targetTenantId,
        name: { equals: name, mode: 'insensitive' },
        ...collectionFilter,
      },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await prisma.entity.findFirst({
      where: {
        tenantId: target.targetTenantId,
        aliases: { has: name },
        ...collectionFilter,
      },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await prisma.entity.findFirst({
      where: {
        tenantId: target.targetTenantId,
        name: { contains: name, mode: 'insensitive' },
        ...collectionFilter,
      },
      orderBy: { documents: { _count: 'desc' } },
    }));

  await recordUsage(
    caller,
    [{ meter: 'GRAPH_QUERIES', quantity: 1 }],
    target.listing.slug,
    'graph_lookup',
  );

  if (!entity) {
    return {
      found: false,
      outgoing: [],
      incoming: [],
      documents: [],
      summaryText: `No entity matching "${name}" was found in this knowledge graph.`,
    };
  }

  const [outgoingRows, incomingRows, docLinks] = await Promise.all([
    prisma.relationship.findMany({
      where: {
        tenantId: target.targetTenantId,
        fromEntityId: entity.id,
        ...(target.documentIds && {
          toEntity: { documents: { some: { documentId: { in: target.documentIds } } } },
        }),
      },
      include: { toEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: 24,
    }),
    prisma.relationship.findMany({
      where: {
        tenantId: target.targetTenantId,
        toEntityId: entity.id,
        ...(target.documentIds && {
          fromEntity: { documents: { some: { documentId: { in: target.documentIds } } } },
        }),
      },
      include: { fromEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: 24,
    }),
    prisma.documentEntity.findMany({
      where: {
        tenantId: target.targetTenantId,
        entityId: entity.id,
        ...(target.documentIds && { documentId: { in: target.documentIds } }),
      },
      include: { document: { select: { id: true, title: true, category: true } } },
      orderBy: { mentions: 'desc' },
      take: 8,
    }),
  ]);

  const firstEvidence = (meta: unknown): string | undefined => {
    const ev = (meta as { evidence?: string[] } | null)?.evidence?.[0];
    return typeof ev === 'string' && ev.length > 0 ? ev.slice(0, 200) : undefined;
  };

  const outgoing = outgoingRows.map((r) => ({
    type: r.type,
    target: r.toEntity.name,
    targetType: r.toEntity.type,
    confidence: r.confidence,
    ...(firstEvidence(r.metadata) && { evidence: firstEvidence(r.metadata) }),
  }));

  const incoming = incomingRows.map((r) => ({
    source: r.fromEntity.name,
    sourceType: r.fromEntity.type,
    type: r.type,
    confidence: r.confidence,
    ...(firstEvidence(r.metadata) && { evidence: firstEvidence(r.metadata) }),
  }));

  const documents = docLinks.map((d) => ({
    id: d.document.id,
    title: d.document.title,
    category: d.document.category,
    mentions: d.mentions,
  }));

  const attributes = (entity.metadata as { attributes?: Record<string, unknown> } | null)
    ?.attributes;

  const lines: string[] = [
    `Entity: ${entity.name} (${entity.type})${entity.aliases.length > 0 ? ` — aliases: ${entity.aliases.join(', ')}` : ''}`,
  ];
  if (attributes && Object.keys(attributes).length > 0) {
    lines.push(`Attributes: ${JSON.stringify(attributes)}`);
  }
  if (outgoing.length > 0) {
    lines.push('\nOutgoing relationships:');
    for (const r of outgoing) {
      lines.push(
        `- ${r.type} → ${r.target} (${r.targetType})${r.evidence ? ` — "${r.evidence}"` : ''}`,
      );
    }
  }
  if (incoming.length > 0) {
    lines.push('\nIncoming relationships:');
    for (const r of incoming) {
      lines.push(
        `- ${r.source} (${r.sourceType}) ${r.type} →${r.evidence ? ` — "${r.evidence}"` : ''}`,
      );
    }
  }
  if (documents.length > 0) {
    lines.push('\nMentioned in documents:');
    for (const d of documents) {
      lines.push(`- ${d.title} (${d.mentions} mentions)`);
    }
  }

  return {
    found: true,
    entity: {
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases,
      ...(attributes && Object.keys(attributes).length > 0 && { attributes }),
    },
    outgoing,
    incoming,
    documents,
    summaryText: lines.join('\n'),
  };
}

export async function executeIndexCategories(
  target: Extract<ResolvedMarketplaceTarget, { kind: 'INDEX' }>,
): Promise<Array<{ category: string; documents: number; chunks: number }>> {
  if (!target.targetTenantId) {
    return (target.listing.stats?.categories ?? []).map((category) => ({
      category,
      documents: 0,
      chunks: 0,
    }));
  }

  const grouped = await prisma.document.groupBy({
    by: ['category'],
    where: {
      tenantId: target.targetTenantId,
      status: 'INDEXED',
      ...(target.collectionId && { collectionId: target.collectionId }),
    },
    _count: true,
    _sum: { chunksCount: true },
  });

  return grouped
    .filter((g) => Boolean(g.category))
    .map((g) => ({
      category: g.category!,
      documents: g._count,
      chunks: g._sum.chunksCount ?? 0,
    }))
    .sort((a, b) => b.documents - a.documents);
}

export async function executeMcpGatewayCall(
  target: Extract<ResolvedMarketplaceTarget, { kind: 'MCP' }>,
  params: { tool: string; arguments?: Record<string, unknown> },
  caller: MarketplaceCaller,
): Promise<{ ok: boolean; output: string; latencyMs: number }> {
  const startedAt = Date.now();
  if (!target.serverRef) {
    throw new MarketplaceInputError(
      `Upstream MCP server for "${target.listing.name}" is not configured on this deployment yet.`,
      503,
    );
  }
  const toolName = params.tool.trim();
  if (!toolName) {
    throw new MarketplaceInputError('tool name is required');
  }

  const available = await listMcpTools(target.serverRef);
  if (!available.some((t) => t.name === toolName)) {
    throw new MarketplaceInputError(
      `Unknown tool "${toolName}" on ${target.listing.slug}. Available: ${available.map((t) => t.name).join(', ') || 'none'}`,
      404,
    );
  }

  const output = await callMcpTool(target.serverRef, toolName, params.arguments ?? {});
  await recordUsage(
    caller,
    [{ meter: 'AGENTIC_QUERIES', quantity: 1 }],
    target.listing.slug,
    `mcp:${toolName}`,
  );

  return {
    ok: !output.startsWith(`Tool "${toolName}" on `) && !output.startsWith('Could not reach '),
    output,
    latencyMs: Date.now() - startedAt,
  };
}
