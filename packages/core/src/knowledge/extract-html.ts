/**
 * HTML → clean text + metadata. cheerio narrows to the content region and
 * pulls links/title; html-to-text handles block-aware text conversion.
 */
import * as cheerio from 'cheerio';
import { convert } from 'html-to-text';

export interface ExtractedPage {
  title: string;
  text: string;
  /** Absolute, normalized, same-document-scheme links found on the page. */
  links: string[];
}

const STRIP_SELECTORS = 'script, style, noscript, svg, iframe, form, nav, header, footer, aside';

/** Normalize a URL for crawl dedupe: drop hash + tracking params + trailing slash. */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  const params = url.searchParams;
  for (const key of [...params.keys()]) {
    if (/^(utm_|gclid|fbclid|msclkid|mc_)/i.test(key)) params.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();

  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

export function extractHtml(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    pageUrl;

  const links: string[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const normalized = normalizeUrl($(el).attr('href') ?? '', pageUrl);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      links.push(normalized);
    }
  });

  $(STRIP_SELECTORS).remove();
  const region = $('main, article, [role="main"]').first();
  const contentHtml = (region.length ? region.html() : $('body').html()) ?? '';

  const text = convert(contentHtml, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text, links };
}
