/**
 * Tenant file storage on S3 — the AWS counterpart of `blob.ts`.
 *
 * One private bucket, one key prefix per tenant (`t-<tenantId>/…`), the same
 * partition scheme the Azure side gets from one container per tenant.
 */
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWS_RESOURCES, awsRegion, getS3Client } from './aws.js';
import { tenantContainerName } from './blob.js';

function documentsBucket(): string {
  const bucket = AWS_RESOURCES.documentsBucket();
  if (!bucket) throw new Error('HORUS_S3_DOCUMENTS_BUCKET is required for file storage on AWS');
  return bucket;
}

export function isS3StorageConfigured(): boolean {
  return Boolean(AWS_RESOURCES.documentsBucket());
}

export function tenantObjectKey(tenantId: string, path: string): string {
  return `${tenantContainerName(tenantId)}/${path}`;
}

/** Stable, non-public URL recorded on the row; reads go through the API. */
export function s3ObjectUrl(key: string): string {
  return `https://${documentsBucket()}.s3.${awsRegion()}.amazonaws.com/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export async function putTenantObject(params: {
  tenantId: string;
  path: string;
  data: Uint8Array;
  contentType: string;
}): Promise<string> {
  const key = tenantObjectKey(params.tenantId, params.path);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: documentsBucket(),
      Key: key,
      Body: params.data,
      ContentType: params.contentType,
    }),
  );
  return s3ObjectUrl(key);
}

/** Presigned PUT for a browser or SDK upload straight to S3. */
export async function presignTenantUpload(params: {
  tenantId: string;
  path: string;
  contentType: string;
  expiresInSeconds: number;
}): Promise<{ url: string; key: string; headers: Record<string, string> }> {
  const key = tenantObjectKey(params.tenantId, params.path);
  const url = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({ Bucket: documentsBucket(), Key: key, ContentType: params.contentType }),
    { expiresIn: params.expiresInSeconds },
  );
  return { url, key, headers: { 'Content-Type': params.contentType } };
}

export async function deleteTenantObject(params: {
  tenantId: string;
  path: string;
}): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: documentsBucket(),
      Key: tenantObjectKey(params.tenantId, params.path),
    }),
  );
}
