/**
 * Agent tools + citation tracking.
 *
 * Tool results hand the model numbered passages; the registry keeps the
 * mapping from those numbers to real sources so the final answer's [n]
 * markers resolve to clickable citations in the UI.
 */
import type { ToolDefinitionUnion } from '@azure/ai-agents';
import { prisma } from '@horus/db';
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
  {
    type: 'function',
    function: {
      name: 'graph_lookup',
      description:
        "Look up an entity (organization, program, sector, occupation, skill, location…) in the workspace knowledge graph and see how it connects: what funds it, what it targets, which skills and occupations it involves, which documents mention it. Use for relationship questions ('what programs fund X', 'how does Y connect to Z') and to enrich deep-dives. Complements search_knowledge — graph for structure, search for passages.",
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            description: 'Entity name to look up, e.g. "TAFE SA", "Fee-Free TAFE", "defence".',
          },
        },
        required: ['entity'],
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
  /** Restrict retrieval to these sourceIds (collection-scoped agents). */
  sourceIds?: string[];
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
    ...(scope.sourceIds && { filters: { sourceIds: scope.sourceIds } }),
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

const GRAPH_RELS_PER_DIRECTION = 24;

/**
 * graph_lookup — resolve an entity in the tenant's Postgres knowledge graph
 * and hand the model a structured neighborhood: grouped edges with evidence
 * quotes, plus the documents that mention the entity (registered as
 * citations). The playground tenant has no graph; degrade honestly.
 */
export async function executeGraphLookup(
  scope: ToolScope,
  registry: CitationRegistry,
  entityName: string,
): Promise<string> {
  const name = entityName.trim().slice(0, 120);
  if (!name) return 'graph_lookup needs an entity name.';

  const entity =
    (await prisma.entity.findFirst({
      where: { tenantId: scope.tenantId, name: { equals: name, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await prisma.entity.findFirst({
      where: { tenantId: scope.tenantId, aliases: { has: name } },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await prisma.entity.findFirst({
      where: { tenantId: scope.tenantId, name: { contains: name, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    }));

  if (!entity) {
    return `No entity matching "${name}" in the knowledge graph. Fall back to search_knowledge.`;
  }

  const [outgoing, incoming, docLinks] = await Promise.all([
    prisma.relationship.findMany({
      where: { tenantId: scope.tenantId, fromEntityId: entity.id },
      include: { toEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: GRAPH_RELS_PER_DIRECTION,
    }),
    prisma.relationship.findMany({
      where: { tenantId: scope.tenantId, toEntityId: entity.id },
      include: { fromEntity: { select: { name: true, type: true } } },
      orderBy: { confidence: 'desc' },
      take: GRAPH_RELS_PER_DIRECTION,
    }),
    prisma.documentEntity.findMany({
      where: { tenantId: scope.tenantId, entityId: entity.id },
      include: { document: { select: { id: true, title: true, category: true } } },
      orderBy: { mentions: 'desc' },
      take: 4,
    }),
  ]);

  const lines: string[] = [];
  const attributes = (entity.metadata as { attributes?: Record<string, unknown> }).attributes;
  lines.push(
    `Entity: ${entity.name} (${entity.type})` +
      (entity.aliases.length > 0 ? ` — aka ${entity.aliases.join(', ')}` : ''),
  );
  if (attributes && Object.keys(attributes).length > 0) {
    lines.push(`Attributes: ${JSON.stringify(attributes)}`);
  }

  const evidenceOf = (meta: unknown): string => {
    const ev = (meta as { evidence?: string[] })?.evidence?.[0];
    return ev ? ` — "${ev.slice(0, 140)}"` : '';
  };
  if (outgoing.length > 0) {
    lines.push('\nOutgoing:');
    for (const rel of outgoing) {
      lines.push(
        `- ${rel.type} → ${rel.toEntity.name} (${rel.toEntity.type})${evidenceOf(rel.metadata)}`,
      );
    }
  }
  if (incoming.length > 0) {
    lines.push('\nIncoming:');
    for (const rel of incoming) {
      lines.push(
        `- ${rel.fromEntity.name} (${rel.fromEntity.type}) ${rel.type} →${evidenceOf(rel.metadata)}`,
      );
    }
  }
  if (outgoing.length === 0 && incoming.length === 0) {
    lines.push('No recorded relationships yet.');
  }

  if (docLinks.length > 0) {
    lines.push('\nMentioned in (cite as [n]):');
    for (const link of docLinks) {
      const n = registry.register({
        key: `graphdoc:${link.document.id}`,
        title: link.document.title,
        sourceType: 'pdf',
        snippet: `${entity.name} — ${link.mentions} mention(s) in ${link.document.title}`,
      });
      lines.push(`[${n}] ${link.document.title} (${link.mentions} mentions)`);
    }
  }

  return lines.join('\n');
}
