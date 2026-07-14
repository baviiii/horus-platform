/**
 * Agent tools + citation tracking.
 *
 * Tool results hand the model numbered passages; the registry keeps the
 * mapping from those numbers to real sources so the final answer's [n]
 * markers resolve to clickable citations in the UI.
 */
import type { ToolDefinitionUnion } from '@azure/ai-agents';
import { embedQuery } from '../knowledge/embeddings.js';
import { searchKnowledge } from '../knowledge/store.js';
import { extractHtml } from '../knowledge/extract-html.js';
import { blockedUrlReason } from '../knowledge/net-guard.js';
import { CRAWLER_USER_AGENT } from '../knowledge/crawl.js';

export interface AgentCitation {
  n: number;
  title: string;
  /** http(s) URL for web sources; undefined for uploaded PDFs. */
  url?: string;
  sourceType: 'url' | 'pdf' | 'web';
  snippet: string;
}

/** Numbers citations across the whole turn; dedupes by citation target. */
export class CitationRegistry {
  private byKey = new Map<string, AgentCitation>();

  register(params: {
    key: string;
    title: string;
    url?: string;
    sourceType: AgentCitation['sourceType'];
    snippet: string;
  }): number {
    const existing = this.byKey.get(params.key);
    if (existing) return existing.n;
    const citation: AgentCitation = {
      n: this.byKey.size + 1,
      title: params.title,
      url: params.url,
      sourceType: params.sourceType,
      snippet: params.snippet.slice(0, 240),
    };
    this.byKey.set(params.key, citation);
    return citation.n;
  }

  all(): AgentCitation[] {
    return [...this.byKey.values()].sort((a, b) => a.n - b.n);
  }
}

/** Function tools the web app executes locally when the Agent Service requests them. */
export const AGENT_FUNCTION_TOOLS: ToolDefinitionUnion[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        "Search the user's connected knowledge base (crawled websites + uploaded PDFs). Call this before answering any factual question. Returns numbered passages; cite them as [n].",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — rephrase the user question into good search terms.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description:
        'Fetch a live web page and return its readable text. Use only when the user shares a URL mid-conversation or asks about a specific page not in the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
        },
        required: ['url'],
      },
    },
  },
];

/**
 * Full toolset for the playground agent: our function tools, plus
 * Grounding-with-Bing when a project connection is configured (server-side
 * live web search executed by the Agent Service itself).
 */
export function buildAgentTools(): ToolDefinitionUnion[] {
  const tools = [...AGENT_FUNCTION_TOOLS];
  const bingConnectionId = process.env.AZURE_BING_CONNECTION_ID;
  if (bingConnectionId) {
    tools.push({
      type: 'bing_grounding',
      bingGrounding: { searchConfigurations: [{ connectionId: bingConnectionId, count: 5 }] },
    });
  }
  return tools;
}

export interface ToolScope {
  indexName: string;
  tenantId: string;
  sessionId: string;
  topK: number;
}

const PASSAGE_CHARS = 800;
const FETCH_PAGE_CHARS = 6000;

export async function executeSearchKnowledge(
  scope: ToolScope,
  registry: CitationRegistry,
  query: string,
): Promise<string> {
  const vector = await embedQuery(query);
  const hits = await searchKnowledge({
    indexName: scope.indexName,
    tenantId: scope.tenantId,
    sessionId: scope.sessionId,
    query,
    vector,
    top: scope.topK,
  });

  if (hits.length === 0) {
    return 'No matching passages in the knowledge base. Tell the user you could not find this in their connected sources — do not guess.';
  }

  return hits
    .map((hit) => {
      const isWeb = hit.sourceType === 'url';
      const n = registry.register({
        key: isWeb ? hit.sourceUrl : `${hit.sourceId}:pdf`,
        title: hit.title,
        url: isWeb ? hit.sourceUrl : undefined,
        sourceType: hit.sourceType,
        snippet: hit.content,
      });
      const where = isWeb ? hit.sourceUrl : `${hit.title} (uploaded PDF)`;
      return `[${n}] ${hit.title} — ${where}\n${hit.content.slice(0, PASSAGE_CHARS)}`;
    })
    .join('\n\n---\n\n');
}

export async function executeFetchPage(registry: CitationRegistry, url: string): Promise<string> {
  const blocked = blockedUrlReason(url);
  if (blocked) return `Cannot fetch that URL: ${blocked}.`;

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    if (!res.ok) return `Fetch failed with HTTP ${res.status}.`;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      return `That URL is not an HTML page (content-type: ${contentType || 'unknown'}).`;
    }
    const page = extractHtml((await res.text()).slice(0, 1_500_000), url);
    if (page.text.length < 80) return 'The page had no readable text content.';

    const n = registry.register({
      key: url,
      title: page.title,
      url,
      sourceType: 'web',
      snippet: page.text,
    });
    return `[${n}] ${page.title} — ${url}\n${page.text.slice(0, FETCH_PAGE_CHARS)}`;
  } catch {
    return 'Fetch failed (timeout or network error).';
  }
}
