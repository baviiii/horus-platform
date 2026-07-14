/**
 * Bounded same-origin crawler for the "point an agent at a website" flow.
 *
 * Good-citizen defaults: respects robots.txt Disallow for UA *, identifies
 * itself, caps pages/depth/time, and never leaves the seed's origin.
 */
import { blockedUrlReason } from './net-guard.js';
import { extractHtml, normalizeUrl, type ExtractedPage } from './extract-html.js';

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  /** Total wall-clock budget for the whole crawl. */
  budgetMs?: number;
  /** Per-page fetch timeout. */
  pageTimeoutMs?: number;
  concurrency?: number;
  /** Called as each page lands (for progress streaming). */
  onPage?: (page: CrawledPage, fetchedCount: number) => void;
}

export interface CrawledPage extends ExtractedPage {
  url: string;
  depth: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  skipped: number;
  errors: number;
}

const DEFAULTS = {
  maxPages: 20,
  maxDepth: 2,
  budgetMs: 60_000,
  pageTimeoutMs: 10_000,
  concurrency: 4,
} as const;

export const CRAWLER_USER_AGENT = 'HorusBot/0.1 (+https://horus.dev; knowledge-ingest demo)';

const MAX_HTML_BYTES = 1_500_000;

async function fetchRobotsDisallows(origin: string, timeoutMs: number): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const body = (await res.text()).slice(0, 100_000);

    // Minimal parser: collect Disallow lines from User-agent: * groups.
    const disallows: string[] = [];
    let appliesToUs = false;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/#.*$/, '').trim();
      const [key, ...rest] = line.split(':');
      if (!key || rest.length === 0) continue;
      const value = rest.join(':').trim();
      const k = key.trim().toLowerCase();
      if (k === 'user-agent') appliesToUs = value === '*';
      else if (k === 'disallow' && appliesToUs && value) disallows.push(value);
    }
    return disallows;
  } catch {
    return []; // unreachable robots.txt ⇒ assume allowed
  }
}

function isDisallowed(pathname: string, disallows: string[]): boolean {
  return disallows.some((rule) => pathname.startsWith(rule));
}

/** Obvious non-HTML asset extensions we never enqueue. */
const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|rss|zip|gz|tar|mp[34]|webm|mov|avi|woff2?|ttf|eot|pdf|docx?|xlsx?|pptx?)$/i;

export async function crawlSite(seedUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const opts = { ...DEFAULTS, ...options };

  const seed = normalizeUrl(seedUrl);
  if (!seed) throw new Error('Invalid seed URL');
  const blocked = blockedUrlReason(seed);
  if (blocked) throw new Error(blocked);

  const origin = new URL(seed).origin;
  const deadline = Date.now() + opts.budgetMs;
  const disallows = await fetchRobotsDisallows(origin, opts.pageTimeoutMs);

  const queue: Array<{ url: string; depth: number }> = [{ url: seed, depth: 0 }];
  const enqueued = new Set<string>([seed]);
  const pages: CrawledPage[] = [];
  let skipped = 0;
  let errors = 0;

  async function fetchOne(url: string, depth: number): Promise<void> {
    if (isDisallowed(new URL(url).pathname, disallows)) {
      skipped++;
      return;
    }
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(opts.pageTimeoutMs),
        redirect: 'follow',
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.includes('text/html')) {
        skipped++;
        return;
      }
      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      const page = extractHtml(html, url);
      if (page.text.length < 80) {
        skipped++; // boilerplate-only page, not worth indexing
        return;
      }

      pages.push({ ...page, url, depth });
      opts.onPage?.({ ...page, url, depth }, pages.length);

      if (depth < opts.maxDepth) {
        for (const link of page.links) {
          if (enqueued.size >= opts.maxPages * 5) break; // frontier cap
          if (enqueued.has(link)) continue;
          const u = new URL(link);
          if (u.origin !== origin) continue;
          if (SKIP_EXTENSIONS.test(u.pathname)) continue;
          if (blockedUrlReason(link)) continue;
          enqueued.add(link);
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch {
      errors++;
    }
  }

  // Simple worker pool over a shared queue.
  async function worker(): Promise<void> {
    while (queue.length > 0 && pages.length < opts.maxPages && Date.now() < deadline) {
      const next = queue.shift();
      if (!next) return;
      await fetchOne(next.url, next.depth);
    }
  }

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));

  return { pages: pages.slice(0, opts.maxPages), skipped, errors };
}
