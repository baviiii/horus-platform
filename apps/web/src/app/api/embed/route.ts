import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasAllScopes, SCOPES } from '@horus/auth';
import { prisma } from '@horus/db';
import { embed, EMBED_MAX_INPUTS } from '@horus/core/inference';
import { aiOffResponse, aiErrorStatus } from '@/lib/ai-status';

// bcryptjs (used by validateApiKey) needs Node, not the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/embed — vectors for a batch of short texts.
 *
 * The first caller is CareerCraft, ranking job adverts and news against a
 * user's profile. That is a similarity problem, not a generation one: exact
 * text matching cannot tell that "Enrolled Nurse" and "Patient Care Assistant"
 * describe the same job market, and no synonym list ever closes over job
 * titles or the ways an advert can phrase a skill. The caller sends the
 * profile plus every item in one request and takes the cosine itself; nothing
 * is stored on either side.
 *
 * Serves text-embedding-3-small only, on its own deployment. `large` is not
 * offered here on purpose: the only large deployment is the knowledge index's
 * (50K TPM), and letting outside callers onto it would let a busy search page
 * throttle Horus's own retrieval for every tenant. If small ever proves too
 * weak, the fix is a dedicated large deployment, not reusing that one.
 *
 * Scope is INTELLIGENCE_INFER rather than a new embedding scope. Embedding is
 * an inference call, and reusing it means existing tenant keys work unchanged —
 * a new scope would require re-minting every key for no security gain.
 */

/** Rejected outright — no real job advert or profile is this long. */
const MAX_CHARS_PER_INPUT = 8_000;
/**
 * Per-item limits are enforced by the schema; this catches a batch where each
 * input is individually legal but the whole is not. (Inputs are truncated to
 * EMBED_MAX_CHARS before embedding regardless — see core/inference/embed.ts.)
 */
const MAX_TOTAL_CHARS = 200_000;
/** text-embedding-3-small's native width. */
const NATIVE_DIMENSIONS = 1536;
/**
 * Vercel refuses function responses over 4.5 MB, and a float serialises to
 * ~19 bytes of JSON. Checked BEFORE calling Azure: past this, the caller would
 * be billed and metered for vectors it never receives.
 */
const MAX_RESPONSE_FLOATS = 150_000;

const BodySchema = z.object({
  input: z.array(z.string().trim().min(1).max(MAX_CHARS_PER_INPUT)).min(1).max(EMBED_MAX_INPUTS),
  /** Accepted for forward compatibility; only 'small' is served (see above). */
  model: z.literal('small').default('small'),
  /**
   * Matryoshka truncation. At native width, one profile plus 50 jobs is
   * ~1.5 MB of JSON; ranking needs nothing like that, and 512 cuts it to
   * ~470 KB at little cost to ordering.
   */
  dimensions: z.number().int().min(64).max(NATIVE_DIMENSIONS).optional(),
});

/** Bearer is standard; the Azure-style header matches /api/infer. */
function readKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
  const fn = req.headers.get('x-functions-key');
  return fn ? fn.trim() : null;
}

export async function POST(req: Request) {
  const aiOff = aiOffResponse();
  if (aiOff) return aiOff;

  // 1. Authenticate.
  const token = readKey(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }
  const auth = await validateApiKey(token);
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  // 2. Authorize.
  if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
    return NextResponse.json(
      { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
      { status: 403 },
    );
  }

  // 3. Validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const totalChars = parsed.data.input.reduce((sum, s) => sum + s.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return NextResponse.json(
      { error: `Batch too large: ${totalChars} characters, limit ${MAX_TOTAL_CHARS}` },
      { status: 400 },
    );
  }
  const width = parsed.data.dimensions ?? NATIVE_DIMENSIONS;
  if (parsed.data.input.length * width > MAX_RESPONSE_FLOATS) {
    return NextResponse.json(
      {
        error:
          `Response too large: ${parsed.data.input.length} inputs × ${width} dimensions. ` +
          `Ask for fewer dimensions (512 is plenty for ranking) or send fewer inputs.`,
      },
      { status: 400 },
    );
  }

  // 4. Embed.
  let result;
  try {
    result = await embed(parsed.data.input, {
      model: parsed.data.model,
      dimensions: parsed.data.dimensions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed';
    return NextResponse.json({ error: message }, { status: aiErrorStatus(err) });
  }

  // 5. Meter against the key's tenant. A ledger hiccup must not cost the
  //    caller vectors it has already been billed for upstream.
  try {
    await prisma.usageRecord.create({
      data: {
        tenantId: auth.tenantId,
        apiKeyId: auth.apiKey.id,
        meter: 'EMBEDDINGS',
        quantity: BigInt(result.tokens),
        metadata: {
          route: '/api/embed',
          model: result.model,
          inputs: parsed.data.input.length,
          dimensions: result.dimensions,
        },
      },
    });
  } catch (err) {
    console.error('[api/embed] usage metering failed', err);
  }

  return NextResponse.json({
    vectors: result.vectors,
    count: result.vectors.length,
    /* Returned so a caller can refuse to compare vectors produced by
       different models or widths. Nothing downstream stores these today, but
       a mismatch would be silent and the numbers would look plausible. */
    model: result.model,
    dimensions: result.dimensions,
    tokens: result.tokens,
  });
}
