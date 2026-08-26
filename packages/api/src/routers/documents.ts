import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';
import { router, scopedProcedure } from '../trpc.js';
import { Prisma } from '@horus/db';
import { UploadMetadataSchema } from '@horus/core/documents';
import { clients } from '@horus/core';

function parseStorageConnection(): { account: string; key: string } {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Azure Blob Storage is not configured (AZURE_STORAGE_CONNECTION_STRING missing). Use the UI upload route which streams through the server, or configure storage.',
    });
  }
  const account = /AccountName=([^;]+)/.exec(conn)?.[1];
  const key = /AccountKey=([^;]+)/.exec(conn)?.[1];
  if (!account || !key) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AZURE_STORAGE_CONNECTION_STRING is missing AccountName or AccountKey.',
    });
  }
  return { account, key };
}

export const documentsRouter = router({
  list: scopedProcedure('documents:read')
    .input(
      z.object({
        status: z.enum(['PENDING', 'PROCESSING', 'INDEXED', 'FAILED', 'ARCHIVED']).optional(),
        category: z.string().optional(),
        collectionId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.document.findMany({
        where: {
          ...(input.status && { status: input.status }),
          ...(input.category && { category: input.category }),
          ...(input.collectionId && { collectionId: input.collectionId }),
        },
        take: input.limit,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
      });
    }),

  get: scopedProcedure('documents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUnique({ where: { id: input.id } });
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
      return doc;
    }),

  /**
   * Direct-to-blob upload: returns a 15-minute SAS URL the client PUTs the
   * file to, plus a PENDING document row. The client then calls
   * `documents.commitUpload` (or the ingestion worker picks the blob up) to
   * run chunk → embed → index.
   *
   * Falls back cleanly: when storage isn't configured, the caller should use
   * the existing `/api/documents/upload` server-streaming route instead.
   */
  requestUpload: scopedProcedure('documents:write')
    .input(
      UploadMetadataSchema.extend({
        filename: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(120).default('application/pdf'),
        bytes: z
          .number()
          .int()
          .positive()
          .max(50 * 1024 * 1024),
        collectionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { account, key } = parseStorageConnection();

      const doc = await ctx.db.document.create({
        data: {
          tenantId: ctx.tenant.id,
          collectionId: input.collectionId ?? null,
          title: input.title,
          category: input.category,
          tags: input.tags,
          blobUrl: 'pending', // filled on commit
          blobBytes: BigInt(input.bytes),
          mimeType: input.mimeType,
          status: 'PENDING',
          uploadedById: ctx.user?.id ?? ctx.apiKey!.id,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      const safeName = input.filename.replace(/[^\w.-]+/g, '_').slice(0, 80);
      const blobName = `documents/${randomUUID()}-${safeName}`;
      const credential = new StorageSharedKeyCredential(account, key);
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      const containerName = clients.tenantContainerName(ctx.tenant.id);
      const sas = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse('cw'), // create + write
          startsOn: new Date(Date.now() - 60 * 1000),
          expiresOn: expires,
          contentType: input.mimeType,
        },
        credential,
      ).toString();

      const uploadUrl = `https://${account}.blob.core.windows.net/${containerName}/${blobName}?${sas}`;

      return {
        documentId: doc.id,
        blobName,
        uploadUrl,
        expiresAt: expires.toISOString(),
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': input.mimeType },
      };
    }),

  /** Mark a requested upload as present in blob storage (after client PUT). */
  commitUpload: scopedProcedure('documents:write')
    .input(
      z.object({
        documentId: z.string().uuid(),
        blobUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUnique({ where: { id: input.documentId } });
      if (!doc || doc.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.document.update({
        where: { id: input.documentId },
        data: { blobUrl: input.blobUrl, status: 'PROCESSING' },
      });
    }),

  delete: scopedProcedure('documents:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.document.update({
        where: { id: input.id },
        data: { status: 'ARCHIVED' },
      });
      return { archived: true };
    }),
});
