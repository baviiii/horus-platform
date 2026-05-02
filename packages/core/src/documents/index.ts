// Document intelligence — upload, parse, chunk, embed, tag, extract.
// Implementation lives in:
//   - upload.ts          (porting from azure-functions/pdf-upload)
//   - parser.ts          (porting from azure-functions/pdf-renderer)
//   - chunker.ts
//   - embedder.ts
//   - tagger.ts          (porting from supabase/functions/rag-tag-documents)
//   - charts.ts          (porting from azure-functions/chart-extraction)

export * from './types.js';
