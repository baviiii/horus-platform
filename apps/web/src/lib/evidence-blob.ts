import 'server-only';
import { randomUUID } from 'node:crypto';
import { clients } from '@horus/core';
import { aiProvider } from '@horus/core/provider';

/**
 * Store an uploaded evidence/document binary in the tenant's private blob
 * container (Azure) or S3 prefix (HORUS_AI_PROVIDER=aws). Storage is optional
 * in dev — callers degrade to text-only evidence (blobUrl null) when it isn't
 * configured.
 */
export async function storeTenantBlob(params: {
  tenantId: string;
  prefix: string; // e.g. `incidents/${incidentId}`
  filename: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (aiProvider() === 'aws') return storeOnS3(params);
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) return null;
  try {
    const service = clients.getBlobServiceClient();
    const container = service.getContainerClient(clients.tenantContainerName(params.tenantId));
    await container.createIfNotExists(); // private by default
    const safeName = params.filename.replace(/[^\w.-]+/g, '_').slice(0, 80);
    const blobName = `${params.prefix}/${randomUUID()}-${safeName}`;
    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(Buffer.from(params.data), {
      blobHTTPHeaders: { blobContentType: params.mimeType },
    });
    return blob.url;
  } catch (err) {
    console.warn('evidence blob upload failed (continuing without blob):', err);
    return null;
  }
}

async function storeOnS3(params: {
  tenantId: string;
  prefix: string;
  filename: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (!clients.isS3StorageConfigured()) return null;
  try {
    const safeName = params.filename.replace(/[^\w.-]+/g, '_').slice(0, 80);
    return await clients.putTenantObject({
      tenantId: params.tenantId,
      path: `${params.prefix}/${randomUUID()}-${safeName}`,
      data: params.data,
      contentType: params.mimeType,
    });
  } catch (err) {
    console.warn('evidence S3 upload failed (continuing without blob):', err);
    return null;
  }
}
