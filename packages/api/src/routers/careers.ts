import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { occupationProfile, pathway, sectorProfile, skillGap } from '@horus/module-careers';
import { embedQuery, searchKnowledge } from '@horus/core/knowledge';
import { router, scopedProcedure } from '../trpc.js';

/**
 * Careers vertical — domain-shaped endpoints over the shared graph.
 *
 * These exist so a consumer (CareerCraft) renders answers rather than
 * re-deriving them. The alternative is every consumer reimplementing "what
 * skills does this job need" against `graph.query` primitives, which puts
 * domain logic in the wrong repository and drifts between clients.
 *
 * All reads. Every result carries its source documents and the extracted
 * sentence behind each edge, plus a `coverage` field that says plainly when
 * the corpus is too thin to be relied on.
 */

/** Categories of the corpus that actually contain careers content. */
const CAREERS_CATEGORIES = ['jobs-skills', 'career-guidance', 'education', 'industry', 'workforce'];

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

const NameInput = z.object({ name: z.string().min(2).max(120) });

export const careersRouter = router({
  /**
   * Everything known about a job: skills, qualifications, who employs it, and
   * the documents behind each claim.
   */
  occupation: scopedProcedure('graph:read')
    .input(NameInput)
    .query(async ({ ctx, input }) => {
      const profile = await occupationProfile(ctx.db, input.name);
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No occupation matching "${input.name}" in this workspace's graph.`,
        });
      }
      return profile;
    }),

  /** An industry: the jobs in it, what funds it, and the programs behind it. */
  sector: scopedProcedure('graph:read')
    .input(NameInput)
    .query(async ({ ctx, input }) => {
      const profile = await sectorProfile(ctx.db, input.name);
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No sector matching "${input.name}" in this workspace's graph.`,
        });
      }
      return profile;
    }),

  /**
   * How one thing connects to another — a qualification to a job, a sector to
   * a skill. Returns the actual chain of edges, or `found: false` when the
   * corpus has no route. It never invents one.
   */
  pathway: scopedProcedure('graph:read')
    .input(z.object({ from: z.string().min(2).max(120), to: z.string().min(2).max(120) }))
    .query(async ({ ctx, input }) => {
      const result = await pathway(ctx.db, input.from, input.to);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "Could not resolve one or both endpoints in this workspace's graph.",
        });
      }
      return result;
    }),

  /**
   * What someone still needs for a target job, given what they already have.
   * Skill matching is substring-tolerant in both directions, so "welding"
   * satisfies "welding techniques".
   */
  skillGap: scopedProcedure('graph:read')
    .input(
      z.object({
        target: z.string().min(2).max(120),
        have: z.array(z.string().min(1).max(80)).max(50).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await skillGap(ctx.db, input.target, input.have);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No occupation matching "${input.target}" in this workspace's graph.`,
        });
      }
      return result;
    }),

  /**
   * Semantic search restricted to careers-relevant documents — so a question
   * about training doesn't return budget appropriation tables.
   */
  search: scopedProcedure('rag:read')
    .input(
      z.object({
        query: z.string().min(2).max(500),
        category: z
          .enum(['jobs-skills', 'career-guidance', 'education', 'industry', 'workforce'])
          .optional(),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      const vector = await embedQuery(input.query);
      // Without a category the caller still shouldn't get budget papers, so
      // run one search per careers category and merge by score.
      const categories = input.category ? [input.category] : CAREERS_CATEGORIES;
      const batches = await Promise.all(
        categories.map((category) =>
          searchKnowledge({
            indexName: indexName(),
            tenantId: ctx.tenant.id,
            sessionId: 'workspace',
            query: input.query,
            vector,
            top: input.limit,
            filters: { category },
          }),
        ),
      );

      const merged = batches
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit)
        .map((hit) => ({
          title: hit.title,
          excerpt: hit.content.slice(0, 500),
          sourceUrl: hit.sourceUrl,
          score: hit.score,
        }));

      return { query: input.query, results: merged, searchedCategories: categories };
    }),
});
