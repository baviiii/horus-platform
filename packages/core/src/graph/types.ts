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
