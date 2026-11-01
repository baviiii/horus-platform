import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasAllScopes, SCOPES } from '@horus/auth';
import { infer } from '@horus/core/inference';
import { aiOffResponse, aiErrorStatus } from '@/lib/ai-status';

// bcryptjs (used by validateApiKey) needs Node, not the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/infer — Horus's single gateway to the model.
 *
 * Any service that wants generation (e.g. the interview-coach MCP) calls this
 * with a Horus API key. We: (1) check the key, (2) check it carries the
 * inference scope, (3) generate, and return the model's JSON as a string.
 */

/**
 * Images ride in a user turn as base64 (no data: prefix). Bedrock takes up to
 * 3.75 MB per image, 5 MB as base64; the request as a whole also has to fit
 * Vercel's 4.5 MB body limit, so in practice a few compressed pages.
 */
const MAX_IMAGES = 5;
const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    image: z
      .string()
      .min(1)
      .max(5_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'image must be base64 without a data: prefix'),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  }),
]);

const MessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.union([z.string(), z.array(ContentPartSchema).min(1).max(20)]),
  })
  .refine((m) => typeof m.content === 'string' || m.role === 'user', {
    message: 'Only user messages can carry images',
  });

const BodySchema = z.object({
  task: z.string().min(1),
  system: z.string().min(1),
  messages: z
    .array(MessageSchema)
    .min(1)
    .refine(
      (messages) =>
        messages.reduce(
          (n, m) =>
            n +
            (typeof m.content === 'string'
              ? 0
              : m.content.filter((p) => p.type === 'image').length),
          0,
        ) <= MAX_IMAGES,
      { message: `At most ${MAX_IMAGES} images per request` },
    ),
  model: z.enum(['fast', 'deep']).default('fast'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
  schema: z.record(z.unknown()).optional(),
  schemaName: z.string().optional(),
  tenant: z.string().optional(),
  userRef: z.string().optional(),
});

/** The MCP sends a standard Bearer token; accept the Azure-style header too. */
function readKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
  const fn = req.headers.get('x-functions-key');
  return fn ? fn.trim() : null;
}

export async function POST(req: Request) {
  const aiOff = aiOffResponse();
  if (aiOff) return aiOff;

  // 1. Authenticate — the caller proves identity with a Horus API key.
  const token = readKey(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }
  const auth = await validateApiKey(token);
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  // 2. Authorize — the key must carry the inference scope (admin:* also covers it).
  if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
    return NextResponse.json(
      { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
      { status: 403 },
    );
  }

  // 3. Validate the request body.
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

  // 4. Generate. Tenant comes from the key, not a client-supplied field.
  try {
    const result = await infer({
      task: parsed.data.task,
      system: parsed.data.system,
      messages: parsed.data.messages,
      model: parsed.data.model,
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      schema: parsed.data.schema,
      schemaName: parsed.data.schemaName,
      userRef: parsed.data.userRef,
      tenant: auth.tenantId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Inference failed';
    return NextResponse.json({ error: message }, { status: aiErrorStatus(err) });
  }
}
