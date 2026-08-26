import { prisma } from '@horus/db';
import { ingestPdf } from '@horus/core/knowledge';
import { requireMemberApi, forbidViewerApi } from '@/lib/tenant-api';
import { storeTenantBlob } from '@/lib/evidence-blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_CHUNKS = 400;

/** Same index the workspace agent searches (tenantId partition, "workspace" session). */
const WORKSPACE_PARTITION = 'workspace';

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

/**
 * Workspace document upload — the playground ingest pipeline pointed at the
 * tenant's own partition, with a permanent Document row. After this, the
 * workspace agent (and incident drafting evidence) can cite the document.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const slug = String(form.get('tenant') ?? '');
  const category = form.get('category') ? String(form.get('category')).slice(0, 60) : null;
  const collectionId = form.get('collectionId') ? String(form.get('collectionId')) : undefined;
  const file = form.get('file');
  if (!slug || !(file instanceof File)) {
    return Response.json({ error: 'Missing tenant or file' }, { status: 400 });
  }
  if (!/\.pdf$/i.test(file.name)) {
    return Response.json({ error: 'PDF only for now (URL crawl comes next)' }, { status: 415 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: 'PDF must be between 1 byte and 15 MB' }, { status: 400 });
  }

  const auth = await requireMemberApi(slug);
  if ('error' in auth) return auth.error;
  const viewerBlock = forbidViewerApi(auth);
  if (viewerBlock) return viewerBlock;

  const data = new Uint8Array(await file.arrayBuffer());

  const blobUrl = await storeTenantBlob({
    tenantId: auth.tenant.id,
    prefix: 'documents',
    filename: file.name,
    data,
    mimeType: 'application/pdf',
  });

  const doc = await prisma.document.create({
    data: {
      tenantId: auth.tenant.id,
      ...(collectionId && { collectionId }),
      title: file.name.replace(/\.pdf$/i, ''),
      category,
      blobUrl: blobUrl ?? `pdf:${file.name}`,
      blobBytes: BigInt(file.size),
      mimeType: 'application/pdf',
      status: 'PROCESSING',
      searchIndex: indexName(),
      uploadedById: auth.user.id,
    },
  });

  try {
    const source = await ingestPdf({
      indexName: indexName(),
      tenantId: auth.tenant.id,
      sessionId: WORKSPACE_PARTITION,
      filename: file.name,
      data,
      maxChunks: MAX_CHUNKS,
      emit: () => undefined, // synchronous upload UX; SSE streaming can come later
    });

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: 'INDEXED',
        chunksCount: source.chunkCount,
        indexedAt: new Date(),
        metadata: { sourceId: source.sourceId },
      },
    });
    await prisma.usageRecord.create({
      data: {
        tenantId: auth.tenant.id,
        meter: 'DOCUMENTS_PROCESSED',
        quantity: BigInt(1),
        metadata: { documentId: doc.id, chunks: source.chunkCount },
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: auth.tenant.id,
        userId: auth.user.id,
        action: 'documents.upload',
        resource: 'document',
        resourceId: doc.id,
        metadata: { filename: file.name, chunks: source.chunkCount },
      },
    });

    return Response.json({
      document: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        chunksCount: updated.chunksCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed';
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'FAILED', errorMessage: message.slice(0, 500) },
    });
    return Response.json({ error: message }, { status: 422 });
  }
}
