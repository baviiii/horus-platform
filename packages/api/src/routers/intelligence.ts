import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { embedQuery, searchKnowledge } from '@horus/core/knowledge';
import { infer } from '@horus/core/inference';
import { router, scopedProcedure } from '../trpc.js';
import type { Context } from '../context.js';

type Db = NonNullable<Context['db']>;

/** Tenant knowledge lives in the workspace partition of the shared index. */
const WORKSPACE_PARTITION = 'workspace';

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

/** Graph anchor for a subject: best-matching entity + its strongest edges. */
async function graphContext(db: Db, subject: string) {
  const entity =
    (await db.entity.findFirst({
      where: { name: { equals: subject, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await db.entity.findFirst({
      where: { name: { contains: subject, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    }));
  if (!entity) return null;

  const [outgoing, incoming] = await Promise.all([
    db.relationship.findMany({
      where: { fromEntityId: entity.id },
      include: { toEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: 20,
    }),
    db.relationship.findMany({
      where: { toEntityId: entity.id },
      include: { fromEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: 20,
    }),
  ]);

  const lines = [
    `Anchor entity: ${entity.name} (${entity.type})`,
    ...outgoing.map((r) => `- ${entity.name} ${r.type} → ${r.toEntity.name} (${r.toEntity.type})`),
    ...incoming.map(
      (r) => `- ${r.fromEntity.name} (${r.fromEntity.type}) ${r.type} → ${entity.name}`,
    ),
  ];
  return {
    entity: { id: entity.id, name: entity.name, type: entity.type },
    edgeCount: outgoing.length + incoming.length,
    text: lines.join('\n').slice(0, 3000),
  };
}

const BRIEF_SYSTEM = `You write intelligence briefs for CareerCraft over Australian budget, jobs and skills documents.

STRICT GROUNDING: use ONLY the numbered passages (and the knowledge-graph edges, which come from the same corpus). Every claim and every number cites its passage as [n]. If the passages don't cover something, say so in "gaps" — never fill from world knowledge.

Return ONLY JSON:
{
  "title": string,
  "overview": string,                    // 2-3 tight paragraphs, citations inline [n]
  "key_numbers": [{ "label": string, "value": string, "n": number }],   // dollars, jobs, percentages — max 8
  "programs_and_funding": [{ "name": string, "detail": string, "n": number }],  // max 8
  "skills_and_occupations": [{ "name": string, "detail": string, "n": number }], // max 8
  "outlook": string,                     // trajectory per the documents, cited
  "gaps": [string]                       // what the corpus does NOT answer — honest, max 5
}`;

export const intelligenceRouter = router({
  /**
   * Structured deep-dive into a field, occupation, program, or topic —
   * GraphRAG: graph edges give the shape, retrieved passages give the facts,
   * every claim cited. Powers overviews, field dives, and money-flow views.
   */
  brief: scopedProcedure('rag:read')
    .input(
      z.object({
        subject: z.string().min(2).max(160),
        focus: z.enum(['overview', 'funding', 'skills', 'outlook']).default('overview'),
        category: z.string().max(40).optional(),
        year: z.number().int().min(2015).max(2035).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const graph = await graphContext(ctx.db, input.subject);

      const focusTerms = {
        overview: '',
        funding: ' funding budget investment programs dollars',
        skills: ' skills occupations training qualifications workforce',
        outlook: ' outlook projections growth employment future demand',
      }[input.focus];
      const query = `${input.subject}${focusTerms}`;

      const vector = await embedQuery(query);
      const hits = await searchKnowledge({
        indexName: indexName(),
        tenantId: ctx.tenant.id,
        sessionId: WORKSPACE_PARTITION,
        query,
        vector,
        top: 12,
        filters: {
          ...(input.category && { category: input.category }),
          ...(input.year && { year: input.year }),
        },
      });
      if (hits.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Nothing in the knowledge base matches "${input.subject}" — ingest relevant documents first.`,
        });
      }

      const passages = hits.map((hit, i) => ({
        n: i + 1,
        title: hit.title,
        sourceUrl: hit.sourceUrl,
        content: hit.content.slice(0, 1100),
      }));

      const userMessage = [
        `Subject: ${input.subject} (focus: ${input.focus})`,
        graph ? `\nKnowledge graph:\n${graph.text}` : '',
        '\nPassages:',
        ...passages.map((p) => `[${p.n}] ${p.title}\n${p.content}`),
      ].join('\n');

      const result = await infer({
        task: 'intelligence.brief',
        system: BRIEF_SYSTEM,
        messages: [{ role: 'user', content: userMessage.slice(0, 30_000) }],
        model: 'deep',
        temperature: 0.2,
        maxTokens: 3000,
        tenant: ctx.tenant.slug,
      });

      let brief: Record<string, unknown>;
      try {
        brief = JSON.parse(result.content) as Record<string, unknown>;
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Brief generation failed' });
      }

      await ctx.db.usageRecord.createMany({
        data: [
          {
            tenantId: ctx.tenant.id,
            apiKeyId: ctx.apiKey?.id,
            meter: 'COMPLETION_TOKENS_IN',
            quantity: BigInt(result.usage.inputTokens),
            metadata: { task: 'intelligence.brief' },
          },
          {
            tenantId: ctx.tenant.id,
            apiKeyId: ctx.apiKey?.id,
            meter: 'COMPLETION_TOKENS_OUT',
            quantity: BigInt(result.usage.outputTokens),
            metadata: { task: 'intelligence.brief' },
          },
        ],
      });

      return {
        brief,
        citations: passages.map(({ n, title, sourceUrl }) => ({ n, title, sourceUrl })),
        graph: graph ? { entity: graph.entity, edgeCount: graph.edgeCount } : null,
        model: result.model,
      };
    }),

  contradictions: scopedProcedure('rag:read')
    .input(z.object({ documentIds: z.array(z.string().uuid()).min(2).max(10) }))
    .query(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'intelligence.contradictions — Phase 3',
      });
    }),
});
