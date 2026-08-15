import { z } from 'zod';

export const SearchFiltersSchema = z
  .object({
    documentType: z.string().optional(),
    category: z.string().optional(),
    sector: z.string().optional(),
    region: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const RagQueryInputSchema = z.object({
  query: z.string().min(1).max(4000),
  filters: SearchFiltersSchema.optional(),
  options: z
    .object({
      /**
       * Sized against the corpus, which grew from ~1,300 chunks to ~4,800 when
       * the Content Understanding pipeline landed. At 10 the retrieved set
       * concentrates on whichever documents match the question topically and
       * misses the one that states the fact — measured: "how many workers does
       * the SA defence sector employ" refuses at 10 and answers correctly, with
       * a citation, at 12+. 16 leaves headroom without doubling prompt cost.
       */
      maxSources: z.number().int().min(1).max(50).default(16),
      minConfidence: z.number().min(0).max(1).default(0.7),
      includeChunks: z.boolean().default(false),
      timeAwareRanking: z.boolean().default(true),
      systemPrompt: z.string().optional(),
    })
    .default({}),
});

export type RagQueryInput = z.infer<typeof RagQueryInputSchema>;

export type RagSource = {
  id: string;
  documentId: string;
  title: string;
  pageNumber?: number;
  /** Citation target: the page URL for web sources, `pdf:<filename>` otherwise. */
  sourceUrl?: string;
  excerpt: string;
  score: number;
};

export type RagResponse = {
  answer: string;
  sources: RagSource[];
  confidence: number;
  metadata: {
    tokensUsed: number;
    latencyMs: number;
    model: string;
  };
};
