// Graph extraction & persistence — chunks → typed entities/edges → Postgres.
// Postgres (Entity / Relationship / DocumentEntity, RLS-scoped) is the
// canonical graph store; Cosmos Gremlin is deferred until scale demands it.

export {
  canonicalName,
  extractGraphFromChunks,
  EXTRACTION_PROFILES,
  ExtractedEntitySchema,
  ExtractedRelationshipSchema,
  type ExtractChunkBatchParams,
  type ExtractedEntity,
  type ExtractedRelationship,
  type ExtractionProfile,
  type GraphExtraction,
} from './extract.js';

export { isEdgeTypeValid } from './extract.js';
export { persistGraph, type PersistParams, type PersistResult } from './persist.js';
