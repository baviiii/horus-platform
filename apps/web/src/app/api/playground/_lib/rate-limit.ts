/**
 * In-memory sliding-window rate limiter, keyed by bucket + client IP.
 *
 * Honest scope: single-instance only (fine for the dev/demo deployment).
 * The production move is Upstash Redis with the same interface.
 */

const WINDOW_MS = 60 * 60 * 1000; // all playground buckets are per-hour
const MAX_TRACKED_KEYS = 10_000;

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(bucket: string, ip: string, limitPerHour: number): RateResult {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = hits.get(key)?.filter((t) => t > cutoff) ?? [];

  if (timestamps.length >= limitPerHour) {
    const oldest = timestamps[0]!;
    hits.set(key, timestamps);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  timestamps = [...timestamps, now];
  hits.set(key, timestamps);

  // Bound total memory under abusive key churn.
  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= cutoff)) hits.delete(k);
      if (hits.size <= MAX_TRACKED_KEYS / 2) break;
    }
  }

  return { ok: true, remaining: limitPerHour - timestamps.length, retryAfterSeconds: 0 };
}

export function rateLimitResponse(result: RateResult): Response {
  return Response.json(
    { error: `Rate limit reached — try again in ${result.retryAfterSeconds}s.` },
    { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
  );
}
