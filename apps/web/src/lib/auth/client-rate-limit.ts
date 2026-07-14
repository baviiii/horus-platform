/**
 * Client-side rate limiter for auth forms.
 *
 * Supabase enforces its own server-side limits on `signInWithOtp`,
 * `signInWithPassword`, `signUp`, `resetPasswordForEmail`, etc. This adds a
 * *defense-in-depth* layer in the browser so we:
 *   - stop obvious spam before it ever hits the network,
 *   - give the user an honest "try again in N minutes" message instead of a
 *     raw Supabase 429, and
 *   - throttle brute-force password guessing from a single device.
 *
 * It is intentionally NOT a security boundary on its own — anyone can clear
 * localStorage. The real limit lives in Supabase. This just keeps honest users
 * (and casual abuse) off the network.
 *
 * Backing store: a sliding window of attempt timestamps kept in localStorage so
 * it survives reloads. Falls back to an in-memory Map when storage is blocked
 * (SSR, private mode, storage disabled).
 */

const KEY_PREFIX = 'horus.rl.';

export interface RateLimitOptions {
  /** Max attempts allowed inside the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the next attempt is allowed (0 when not blocked). */
  retryAfterSeconds: number;
}

/** Sensible presets, tuned to be invisible to real users but hostile to bots. */
export const RATE_LIMITS = {
  /** Magic link / signup email / password reset — expensive, email-bound. */
  emailLink: { max: 4, windowMs: 15 * 60 * 1000 },
  /** Password sign-in / sign-up attempts from this device. */
  password: { max: 8, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RateLimitOptions>;

const memory = new Map<string, number[]>();
let storageOk: boolean | null = null;

function hasStorage(): boolean {
  if (storageOk !== null) return storageOk;
  try {
    const probe = '__horus_rl_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storageOk = true;
  } catch {
    storageOk = false;
  }
  return storageOk;
}

function load(key: string): number[] {
  if (hasStorage()) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  }
  return memory.get(key) ?? [];
}

function save(key: string, value: number[]): void {
  if (hasStorage()) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return;
    } catch {
      // fall through to memory
    }
  }
  memory.set(key, value);
}

function keyFor(action: string, id: string): string {
  return `${KEY_PREFIX}${action}:${id.toLowerCase().trim() || 'anon'}`;
}

/**
 * Atomically check the limit and, if allowed, record this attempt.
 *
 * Returns `{ ok: false, retryAfterSeconds }` when the window is full without
 * recording anything. Counting the attempt on the way in (rather than on
 * success) is deliberate: it means repeated *failed* password guesses still
 * burn down the budget.
 */
export function consumeRateLimit(
  action: string,
  id: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const key = keyFor(action, id);
  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const times = load(key).filter((t) => t > cutoff);

  if (times.length >= opts.max) {
    save(key, times);
    const oldest = times[0]!;
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)),
    };
  }

  times.push(now);
  save(key, times);
  return { ok: true, remaining: opts.max - times.length, retryAfterSeconds: 0 };
}

/** Clear a bucket — call after a *successful* auth so the user isn't penalized. */
export function resetRateLimit(action: string, id: string): void {
  const key = keyFor(action, id);
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(key);
      return;
    } catch {
      // fall through
    }
  }
  memory.delete(key);
}

/** "2 minutes" / "45 seconds" — for user-facing throttle messages. */
export function describeWait(seconds: number): string {
  if (seconds >= 90) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const s = Math.max(1, Math.round(seconds));
  return `${s} second${s === 1 ? '' : 's'}`;
}
