// Careers vertical module.
//
// Domain-shaped reads composed over the shared knowledge graph: occupation and
// sector profiles, career pathways, and skill gaps. The engine underneath is
// generic — this module is the careers-specific lens on it, and the pattern a
// future vertical (migration, real estate) would copy.
//
// Everything here is read-only and attributed. Consumers render these results
// directly, so each one carries the documents and the extracted sentences it
// came from, plus an honest `coverage` signal when the corpus is thin.

export { resolveEntity, findVariants, type ResolvedEntity } from './resolve.js';

export {
  occupationProfile,
  sectorProfile,
  type LinkedEntity,
  type OccupationProfile,
  type SectorProfile,
  type SourceDocument,
} from './profile.js';

export {
  pathway,
  skillGap,
  type PathStep,
  type PathwayResult,
  type SkillGapResult,
} from './pathway.js';
