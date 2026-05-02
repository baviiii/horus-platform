import { z } from 'zod';

export const UploadMetadataSchema = z
  .object({
    title: z.string().min(1),
    category: z.string().optional(),
    tags: z.array(z.string()).max(50).default([]),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;
