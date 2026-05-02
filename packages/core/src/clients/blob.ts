import { BlobServiceClient } from '@azure/storage-blob';

let cached: BlobServiceClient | null = null;

export function getBlobServiceClient(): BlobServiceClient {
  if (cached) return cached;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is required');
  }
  cached = BlobServiceClient.fromConnectionString(conn);
  return cached;
}

export function tenantContainerName(tenantId: string): string {
  // Container names: lowercase, alphanumeric + hyphen, 3-63 chars.
  return `t-${tenantId.replace(/[^a-z0-9-]/g, '').slice(0, 60)}`;
}
