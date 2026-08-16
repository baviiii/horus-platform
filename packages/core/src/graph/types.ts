import { z } from 'zod';

export const EntityTypeSchema = z.enum([
  'organization',
  'program',
  'policy',
  'funding',
  'skill',
  'occupation',
  'location',
  'sector',
  'qualification',
  'date_period',
  'metric',
  'person',
  'event',
  'concept',
]);

export const RelationshipTypeSchema = z.enum([
  'funds',
  'employs',
  'requires',
  'located_in',
  'part_of',
  'targets',
  'leads_to',
  'contradicts',
  'supports',
  'competes_with',
  'references',
  'mentions',
]);

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/** Node/edge shapes returned by graph traversal APIs (portable across packages). */
export interface GraphNode {
  id: string;
  name: string;
  type: string;
  docCount: number;
}

export interface GraphEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  confidence: number;
  /**
   * Verbatim sentence the extractor took this relationship from.
   * A traversal without it is an assertion the caller cannot check, which is
   * exactly what the graph exists to avoid — so it travels with the edge.
   */
  evidence?: string;
}
