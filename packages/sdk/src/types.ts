import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@horus/api';

export type HorusInputs = inferRouterInputs<AppRouter>;
export type HorusOutputs = inferRouterOutputs<AppRouter>;

// Convenience aliases for the most-used surfaces
export type RagQueryInput = HorusInputs['rag']['query'];
export type RagChatInput = HorusInputs['rag']['chat'];
export type GraphQueryInput = HorusInputs['graph']['query'];
export type AgenticPlanInput = HorusInputs['agentic']['plan'];
export type DocumentUploadInput = HorusInputs['documents']['requestUpload'];
