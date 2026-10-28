import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@horus/db';
import type { ApiKey } from '@horus/db';

const KEY_BYTES = 24;
const PREFIX_LIVE = 'horus_sk_live_';
const PREFIX_TEST = 'horus_sk_test_';

export type ApiKeyEnv = 'live' | 'test';

/**
 * `createdById` on keys minted by operator scripts (mint-consumer-key,
 * create-dev-key) rather than by a signed-in user. api_keys.created_by_id has
 * no FK, so this synthetic id never collides with a real account.
 */
export const SYSTEM_KEY_CREATOR_ID = '00000000-0000-0000-0000-000000000001';

export type GeneratedApiKey = {
  /** The full secret. Show ONCE on creation, never stored in plaintext. */
  plaintext: string;
  /** Public-displayable prefix (env + first 6 chars of secret). */
  publicPrefix: string;
  /** bcrypt hash for storage. */
  keyHash: string;
};

/** Generate a new API key. The plaintext value is returned ONCE — store it client-side. */
export async function generateApiKey(env: ApiKeyEnv = 'live'): Promise<GeneratedApiKey> {
  const secret = randomBytes(KEY_BYTES).toString('base64url');
  const prefix = env === 'live' ? PREFIX_LIVE : PREFIX_TEST;
  const plaintext = `${prefix}${secret}`;
  const publicPrefix = `${prefix}${secret.slice(0, 6)}`;
  const keyHash = await bcrypt.hash(plaintext, 12);
  return { plaintext, publicPrefix, keyHash };
}

/** Pre-image hash to enable cheap lookup before bcrypt compare. */
function lookupHash(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export type ApiKeyContext = {
  apiKey: ApiKey;
  tenantId: string;
  scopes: string[];
};

/**
 * Validate an API key from the Authorization header.
 * Returns the loaded record + tenantId, or null if invalid/expired/revoked.
 */
export async function validateApiKey(plaintext: string): Promise<ApiKeyContext | null> {
  if (!plaintext || (!plaintext.startsWith(PREFIX_LIVE) && !plaintext.startsWith(PREFIX_TEST))) {
    return null;
  }

  // Lookup candidates by stable hash to avoid bcrypt-comparing every key in the DB.
  // We keep a sha256 in keyHash *prefix* convention is not used here — we instead
  // use the public prefix as the lookup key (12+6 chars is plenty unique).
  const prefix =
    plaintext.slice(0, plaintext.indexOf('_', 9) + 1) +
    plaintext.slice(plaintext.indexOf('_', 9) + 1, plaintext.indexOf('_', 9) + 7);

  const candidates = await prisma.apiKey.findMany({
    where: {
      keyPrefix: prefix,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      // A deactivated tenant's unrevoked keys must stop working everywhere.
      // The tRPC resolver checks this itself; the REST routes (/api/infer,
      // /api/embed, /api/sdk/chat) call this directly and relied on it.
      tenant: { isActive: true },
    },
    take: 5,
  });

  for (const candidate of candidates) {
    const ok = await bcrypt.compare(plaintext, candidate.keyHash);
    if (ok) {
      // Fire-and-forget last-used update
      void prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      });
      return {
        apiKey: candidate,
        tenantId: candidate.tenantId,
        scopes: candidate.scopes,
      };
    }
  }

  return null;
}

/** Lightweight constant-time check of plaintext format. */
export function isApiKeyShape(value: string): boolean {
  return value.startsWith(PREFIX_LIVE) || value.startsWith(PREFIX_TEST);
}

export { lookupHash };
