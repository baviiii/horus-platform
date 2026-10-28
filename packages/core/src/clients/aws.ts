/**
 * AWS configuration shared by every AWS client in Horus.
 *
 * Credentials come from HORUS_AWS_* variables, not the standard AWS_* ones.
 * Vercel runs functions on Lambda and reserves AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY and AWS_REGION for its own execution role, so the
 * default credential chain would sign requests as Vercel's account, not ours.
 * Off Vercel (local dev, scripts) the default chain is fine: `aws sso login`
 * or a profile works with no extra configuration.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { ComprehendClient } from '@aws-sdk/client-comprehend';
import { S3Client } from '@aws-sdk/client-s3';
import { S3VectorsClient } from '@aws-sdk/client-s3vectors';

export interface AwsStaticCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Sydney by default: résumé and tenant data stay onshore. */
export function awsRegion(): string {
  return (
    process.env.HORUS_AWS_REGION ||
    (process.env.VERCEL ? undefined : process.env.AWS_REGION) ||
    'ap-southeast-2'
  );
}

/**
 * Explicit credentials when configured; undefined means "use the default
 * chain". On Vercel the default chain is never correct, so missing
 * credentials there are a configuration error, not a fallback.
 */
export function awsCredentials(): AwsStaticCredentials | undefined {
  const accessKeyId = process.env.HORUS_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HORUS_AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(process.env.HORUS_AWS_SESSION_TOKEN && {
        sessionToken: process.env.HORUS_AWS_SESSION_TOKEN,
      }),
    };
  }
  if (process.env.VERCEL) {
    throw new Error(
      'HORUS_AWS_ACCESS_KEY_ID and HORUS_AWS_SECRET_ACCESS_KEY are required on Vercel ' +
        '(the AWS_* names belong to Vercel’s own Lambda role)',
    );
  }
  return undefined;
}

function clientConfig(): { region: string; credentials?: AwsStaticCredentials } {
  const credentials = awsCredentials();
  return { region: awsRegion(), ...(credentials && { credentials }) };
}

/** Resource names the infrastructure creates; overridable per environment. */
export const AWS_RESOURCES = {
  vectorBucket: (): string => process.env.HORUS_S3VECTORS_BUCKET || 'horus-dev-vectors',
  documentsBucket: (): string | undefined => process.env.HORUS_S3_DOCUMENTS_BUCKET || undefined,
  guardrailId: (): string | undefined => process.env.HORUS_BEDROCK_GUARDRAIL_ID || undefined,
  guardrailVersion: (): string => process.env.HORUS_BEDROCK_GUARDRAIL_VERSION || 'DRAFT',
};

let bedrockRuntime: BedrockRuntimeClient | null = null;
let s3Vectors: S3VectorsClient | null = null;
let s3: S3Client | null = null;
let comprehend: ComprehendClient | null = null;

export function getBedrockRuntimeClient(): BedrockRuntimeClient {
  bedrockRuntime ??= new BedrockRuntimeClient(clientConfig());
  return bedrockRuntime;
}

export function getS3VectorsClient(): S3VectorsClient {
  s3Vectors ??= new S3VectorsClient(clientConfig());
  return s3Vectors;
}

export function getS3Client(): S3Client {
  s3 ??= new S3Client(clientConfig());
  return s3;
}

export function getComprehendClient(): ComprehendClient {
  comprehend ??= new ComprehendClient(clientConfig());
  return comprehend;
}
