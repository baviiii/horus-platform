import { z } from 'zod';

export const PlanStepKindSchema = z.enum([
  'search',
  'graph_query',
  'compare',
  'contradiction_check',
  'synthesize',
  'tool',
]);

export const PlanStepSchema = z.object({
  id: z.number().int().positive(),
  kind: PlanStepKindSchema,
  query: z.string().optional(),
  inputs: z.array(z.number().int().positive()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const QueryPlanSchema = z.object({
  rationale: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(10),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type QueryPlan = z.infer<typeof QueryPlanSchema>;
