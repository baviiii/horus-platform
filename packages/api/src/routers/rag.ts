import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { embedQuery, searchKnowledge } from '@horus/core/knowledge';
import { infer } from '@horus/core/inference';
import { moderateText } from '@horus/core/safety';
import { router, scopedProcedure } from '../trpc.js';
import { RagQueryInputSchema, type RagResponse, type RagSource } from '@horus/core/rag';

/**
 * Retrieval-augmented search over a tenant's corpus.
 *
 * This is the SDK's entry point — the same engine the dashboard agent uses,
 * but reachable with an API key and returning a complete answer rather than a
 * token stream. Streaming lives at `/api/sdk/chat` for callers that want it.
 *
 * Every answer cites the passages it came from. A claim without a citation is
 * a bug, not a stylistic choice — consumers render these to end users who have
 * no way to check the corpus themselves.
 */

/** Tenant knowledge lives in the workspace partition of the shared index. */
const WORKSPACE_PARTITION = 'workspace';

function indexName(): string {
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

/**
 * Voice when the caller sends no systemPrompt of its own.
 *
 * This was a standing rule, so a caller asking for structured records got
 * "be direct" stacked after its own format and lost. Worse, the model put
 * those records under a JSON key of its own, and only `answer` is read below
 * — CareerCraft's careers tab came back empty on every load. Style is the
 * caller's; the rules above, and the envelope sentence, are not.
 */
const DEFAULT_STYLE = `Be direct. Lead with the answer, then the supporting detail.`;

export const ragRouter = router({
  /**
   * Ask a question of the corpus. Retrieval + grounded generation in one call.
   */
  query: scopedProcedure('rag:read')
    .input(RagQueryInputSchema)
    .mutation(async ({ ctx, input }): Promise<RagResponse> => {
      const startedAt = Date.now();

      const verdict = await moderateText(input.query);
      if (verdict.blocked) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Query was blocked by the content policy (${verdict.category}).`,
        });
      }

      const vector = await embedQuery(input.query);
      const hits = await searchKnowledge({
        indexName: indexName(),
        tenantId: ctx.tenant.id,
        sessionId: WORKSPACE_PARTITION,
        query: input.query,
        vector,
        top: input.options.maxSources,
        filters: {
          ...(input.filters?.category && { category: input.filters.category }),
          ...(input.filters?.tags?.length && { tags: input.filters.tags }),
        },
      });

      const sources: RagSource[] = hits.map((hit) => ({
        id: `${hit.sourceId}:${hit.chunkIx}`,
        documentId: hit.sourceId,
        title: hit.title,
        // Both are what a consumer renders a citation from — a page to cite and
        // a link to open. Only chunks from the indexer pipeline carry a page.
        ...(hit.pageNumber !== undefined && { pageNumber: hit.pageNumber }),
        sourceUrl: hit.sourceUrl,
        excerpt: hit.content.slice(0, 400),
        score: hit.score,
      }));

      if (hits.length === 0) {
        return {
          answer:
            'Nothing in the connected corpus matches that question. Try different terms, or check that the relevant documents are indexed.',
          sources: [],
          confidence: 0,
          metadata: { tokensUsed: 0, latencyMs: Date.now() - startedAt, model: 'none' },
        };
      }

      const passages = hits
        .map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.content.slice(0, 1200)}`)
        .join('\n\n');

      const result = await infer({
        task: 'rag.query',
        system: input.options.systemPrompt
          ? `${input.options.systemPrompt}\n\n${ANSWER_SYSTEM}`
          : `${DEFAULT_STYLE}\n\n${ANSWER_SYSTEM}`,
        messages: [{ role: 'user', content: `Question: ${input.query}\n\nPassages:\n${passages}` }],
        model: 'fast',
        temperature: 0.2,
        maxTokens: 1500,
        tenant: ctx.tenant.slug,
      });

      let parsed: { answer?: unknown; confidence?: unknown; answered?: unknown };
      try {
        parsed = JSON.parse(result.content) as typeof parsed;
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Answer generation failed' });
      }

      await meter(ctx, 'rag.query', result.usage);

      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : '',
        // Retrieval found nothing useful even though it returned rows — report
        // that honestly rather than passing off a hedged answer as confident.
        confidence:
          parsed.answered === false
            ? 0
            : typeof parsed.confidence === 'number'
              ? Math.max(0, Math.min(1, parsed.confidence))
              : 0.5,
        sources: input.options.includeChunks ? sources : sources.slice(0, input.options.maxSources),
        metadata: {
          tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          model: result.model,
        },
      };
    }),

  /**
   * Conversational search with persisted history. Non-streaming: tRPC returns
   * a complete answer. Use `/api/sdk/chat` (SSE) when you want tokens live.
   */
  chat: scopedProcedure('rag:read')
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        message: z.string().min(1).max(8000),
        context: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const startedAt = Date.now();

      const verdict = await moderateText(input.message);
      if (verdict.blocked) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message was blocked by the content policy (${verdict.category}).`,
        });
      }

      let session = input.sessionId
        ? await ctx.db.chatSession.findFirst({ where: { id: input.sessionId } })
        : null;
      if (input.sessionId && !session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown session' });
      }
      if (!session) {
        session = await ctx.db.chatSession.create({
          data: {
            tenantId: ctx.tenant.id,
            userId: ctx.user?.id,
            apiKeyId: ctx.apiKey?.id,
            title: input.message.slice(0, 80),
            context: input.context ?? 'sdk',
          },
        });
      }

      await ctx.db.chatMessage.create({
        data: { sessionId: session.id, role: 'USER', content: input.message },
      });

      // Prior turns give the model continuity; retrieval is still per-question.
      const history = await ctx.db.chatMessage.findMany({
        where: { sessionId: session.id, role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      });

      const vector = await embedQuery(input.message);
      const hits = await searchKnowledge({
        indexName: indexName(),
        tenantId: ctx.tenant.id,
        sessionId: WORKSPACE_PARTITION,
        query: input.message,
        vector,
        top: 10,
      });

      const passages = hits
        .map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.content.slice(0, 1000)}`)
        .join('\n\n');

      const result = await infer({
        task: 'rag.chat',
        system: `${DEFAULT_STYLE}\n\n${ANSWER_SYSTEM}`,
        messages: [
          ...history
            .reverse()
            .slice(0, -1)
            .map((m) => ({
              role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
              content: m.content.slice(0, 2000),
            })),
          {
            role: 'user',
            content: `Question: ${input.message}\n\nPassages:\n${passages || '(none found)'}`,
          },
        ],
        model: 'fast',
        temperature: 0.3,
        maxTokens: 1500,
        tenant: ctx.tenant.slug,
      });

      let parsed: { answer?: unknown; confidence?: unknown };
      try {
        parsed = JSON.parse(result.content) as typeof parsed;
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Answer generation failed' });
      }
      const answer = typeof parsed.answer === 'string' ? parsed.answer : '';

      const sources = hits.map((hit, i) => ({
        n: i + 1,
        title: hit.title,
        sourceUrl: hit.sourceUrl,
        excerpt: hit.content.slice(0, 300),
      }));

      await ctx.db.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: answer,
          sources: sources as object,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          modelUsed: result.model,
        },
      });
      await meter(ctx, 'rag.chat', result.usage);

      return {
        sessionId: session.id,
        answer,
        sources,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        metadata: {
          tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          model: result.model,
        },
      };
    }),

  /** Corpus shape — what a consumer can filter on before querying. */
  metadata: scopedProcedure('rag:read')
    .input(z.object({ operation: z.enum(['stats', 'documents', 'categories']) }))
    .query(async ({ ctx, input }) => {
      if (input.operation === 'documents') {
        const documents = await ctx.db.document.findMany({
          where: { status: 'INDEXED' },
          select: { id: true, title: true, category: true, chunksCount: true, indexedAt: true },
          orderBy: { chunksCount: 'desc' },
          take: 200,
        });
        return { operation: 'documents' as const, documents };
      }

      if (input.operation === 'categories') {
        const grouped = await ctx.db.document.groupBy({
          by: ['category'],
          where: { status: 'INDEXED' },
          _count: true,
          _sum: { chunksCount: true },
        });
        return {
          operation: 'categories' as const,
          categories: grouped
            .filter((g) => g.category)
            .map((g) => ({
              category: g.category!,
              documents: g._count,
              chunks: g._sum.chunksCount ?? 0,
            }))
            .sort((a, b) => b.documents - a.documents),
        };
      }

      const [documents, chunks, entities, relationships] = await Promise.all([
        ctx.db.document.count({ where: { status: 'INDEXED' } }),
        ctx.db.document.aggregate({ where: { status: 'INDEXED' }, _sum: { chunksCount: true } }),
        ctx.db.entity.count(),
        ctx.db.relationship.count(),
      ]);
      return {
        operation: 'stats' as const,
        documents,
        chunks: chunks._sum.chunksCount ?? 0,
        entities,
        relationships,
      };
    }),
});

/** Record token spend against the tenant (and the API key, when there is one). */
async function meter(
  ctx: {
    db: NonNullable<import('../context.js').Context['db']>;
    tenant: { id: string };
    apiKey: { id: string } | null;
  },
  task: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await ctx.db.usageRecord
    .createMany({
      data: [
        {
          tenantId: ctx.tenant.id,
          apiKeyId: ctx.apiKey?.id,
          meter: 'COMPLETION_TOKENS_IN',
          quantity: BigInt(usage.inputTokens),
          metadata: { task },
        },
        {
          tenantId: ctx.tenant.id,
          apiKeyId: ctx.apiKey?.id,
          meter: 'COMPLETION_TOKENS_OUT',
          quantity: BigInt(usage.outputTokens),
          metadata: { task },
        },
        {
          tenantId: ctx.tenant.id,
          apiKeyId: ctx.apiKey?.id,
          meter: 'RAG_QUERIES',
          quantity: BigInt(1),
          metadata: { task },
        },
      ],
    })
    .catch(() => undefined); // metering must never fail a user's request
}
