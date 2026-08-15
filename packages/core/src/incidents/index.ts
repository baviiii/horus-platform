// Incident reporting (NDIS vertical) — template absorption, evidence-cited
// drafting, statutory deadlines, de-identification, and .docx export.

export {
  FIELD_TYPES,
  TemplateFieldSchema,
  TemplateSectionSchema,
  TemplateSchemaSchema,
  FieldValueSchema,
  FieldDraftSchema,
  IncidentFieldsSchema,
  EvidenceRefSchema,
  normalizeTemplateSchema,
  isFieldVisible,
  requiredMissing,
  formatFieldValue,
  type FieldType,
  type TemplateField,
  type TemplateSection,
  type TemplateSchema,
  type FieldValue,
  type FieldDraft,
  type IncidentFields,
  type EvidenceRef,
} from './schema.js';

export {
  NDIS_PACK,
  REGULATORY_PACKS,
  categoryByKey,
  addBusinessDays,
  computeDeadlines,
  type IncidentCategory,
  type RegulatoryPack,
  type DeadlineInfo,
} from './reference.js';

export { absorbTemplate, type AbsorbParams, type AbsorbResult } from './absorb.js';

export {
  draftIncidentFields,
  type DraftEvidenceInput,
  type DraftParams,
  type DraftResult,
  type SeverityLevel,
} from './draft.js';

export { deidentifyIncident, type DeidParams, type DeidResult } from './deid.js';

export {
  analyzeIncidentPhoto,
  photoAnalysisToText,
  type AnalyzePhotoParams,
  type PhotoAnalysis,
} from './vision.js';

export {
  renderIncidentDocx,
  type RenderIncidentParams,
  type RenderEvidenceItem,
  type RenderMode,
} from './render.js';

export {
  STARTER_NDIS_TEMPLATE,
  STARTER_TEMPLATE_NAME,
  STARTER_TEMPLATE_DESCRIPTION,
} from './starter-template.js';
