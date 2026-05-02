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
      maxSources: z.number().int().min(1).max(50).default(10),
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
