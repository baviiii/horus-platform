/**
 * Horus Marketplace catalog & target resolution.
 *
 * Unifies first-party Horus offerings (the CareerCraft policy/skills corpus,
 * the Interview Coach MCP server, and every workspace's own Knowledge Bridge)
 * with tenant-published MarketplaceListing records in Postgres.
 *
 * Resilient by design: if `marketplace_listings` or `marketplace_installs`
 * has not been pushed to a database yet (Prisma P2021/P2022), every read
 * degrades cleanly to the first-party catalog instead of failing requests.
 */
import { prisma, type Plan } from '@horus/db';
import { blockedUrlReason } from '../knowledge/net-guard.js';
import { listMcpTools, type McpServerRef } from '../mcp/client.js';

export type MarketplacePlan = Plan;
export type MarketplaceListingKind = 'INDEX' | 'MCP';

export interface MarketplaceToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MarketplaceIndexStats {
  documents: number;
  chunks: number;
  entities: number;
  relationships: number;
  categories: string[];
}

export interface MarketplaceCatalogItem {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  kind: MarketplaceListingKind;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  visibility: 'PUBLIC' | 'UNLISTED';
  category: string;
  tags: string[];
  samplePrompts: string[];
  minPlan: MarketplacePlan;
  verified: boolean;
  featured: boolean;
  firstParty: boolean;
  publisherName: string;
  publisherTenantId: string | null;
  collectionId: string | null;
  connectionId: string | null;
  /** True when the backing index has active indexed docs or the MCP server is configured. */
  live: boolean;
  tools: MarketplaceToolSpec[];
  stats?: MarketplaceIndexStats;
  installCount: number;
  mcpPath: string;
  restPath: string;
}

export type ResolvedMarketplaceTarget =
  | {
      kind: 'INDEX';
      listing: MarketplaceCatalogItem;
      targetTenantId: string;
      collectionId: string | null;
      /** Undefined = full workspace corpus; array = restricted to those sourceIds. */
      sourceIds?: string[];
      /** Undefined = full workspace graph; array = restricted to entities in those documents. */
      documentIds?: string[];
    }
  | {
      kind: 'MCP';
      listing: MarketplaceCatalogItem;
      serverRef: McpServerRef | null;
    };

export const PLAN_RANK: Record<MarketplacePlan, number> = {
  FREE: 0,
  STARTER: 1,
  PRO: 2,
  SCALE: 3,
  ENTERPRISE: 4,
};

export function meetsPlan(callerPlan: MarketplacePlan, requiredPlan: MarketplacePlan): boolean {
  return PLAN_RANK[callerPlan] >= PLAN_RANK[requiredPlan];
}

/** Prisma missing-table / missing-column check so pre-migration environments stay up. */
export function isMissingMarketplaceTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'P2021' || code === 'P2022';
}

/** Allowlisted env-var prefix for tenant-published MCP bearer secrets. */
const TENANT_SECRET_ENV_RE = /^MCP_SECRET_[A-Z0-9_]{1,96}$/;

export function isAllowedTenantSecretRef(secretRef: string | null | undefined): boolean {
  if (!secretRef) return false;
  return TENANT_SECRET_ENV_RE.test(secretRef);
}

/** Canonical MCP tools exposed for every Knowledge Index listing (and `/api/mcp/workspace`). */
export const INDEX_MCP_TOOLS: MarketplaceToolSpec[] = [
  {
    name: 'search_index',
    description:
      'Hybrid/vector passage search over this Horus knowledge index. Returns ranked source passages with titles, page numbers, and citation URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Focused search query or keywords to retrieve relevant passages.',
        },
        topK: {
          type: 'number',
          description: 'Maximum passages to return (1–20, default 8).',
        },
        category: {
          type: 'string',
          description: 'Optional document category filter (call list_categories to inspect).',
        },
        year: {
          type: 'number',
          description: 'Optional publication/budget year filter (e.g. 2026).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tag filters.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ask_index',
    description:
      'Ask a natural-language question grounded strictly in this Horus index. Returns a cited answer ([1], [2]…), confidence score, and structured sources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language question to answer from the corpus.',
        },
        maxSources: {
          type: 'number',
          description: 'Maximum passages to ground the answer on (1–16, default 10).',
        },
        category: {
          type: 'string',
          description: 'Optional category filter.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_lookup',
    description:
      'Look up an organization, program, policy, funding stream, skill, or occupation in the index knowledge graph and traverse its incoming/outgoing relationships with evidence quotes.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity name or alias to inspect (e.g. "TAFE SA", "Fee-Free TAFE").',
        },
      },
      required: ['entity'],
    },
  },
  {
    name: 'list_categories',
    description:
      'List document categories, document counts, and chunk counts indexed in this corpus so you can filter subsequent searches.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const FALLBACK_COACH_TOOLS: MarketplaceToolSpec[] = [
  {
    name: 'research_role',
    description:
      'Research a company, team, engineering culture, and role expectations ahead of an interview.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company or organization name.' },
        role: { type: 'string', description: 'Target role title.' },
      },
      required: ['company', 'role'],
    },
  },
  {
    name: 'study_guide',
    description:
      'Build a structured interview study plan with curated guides, discussions, and practice drills.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role or domain to prepare for.' },
        focus: { type: 'string', description: 'Specific topics or gaps to prioritize.' },
      },
      required: ['role'],
    },
  },
  {
    name: 'start_interview',
    description:
      'Generate calibrated behavioural and technical interview questions tailored to a role and seniority.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Target role title.' },
        level: { type: 'string', description: 'Seniority level (e.g. junior, senior, staff).' },
      },
      required: ['role'],
    },
  },
  {
    name: 'evaluate_answer',
    description:
      'Score a candidate response against structured interview rubrics with actionable feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The interview question asked.' },
        answer: { type: 'string', description: 'Candidate answer transcript or text.' },
      },
      required: ['question', 'answer'],
    },
  },
];

function resolveInterviewCoachUpstream(): McpServerRef | null {
  const explicitUrl = process.env.HORUS_INTERVIEW_COACH_MCP_URL?.trim();
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
    const secret = process.env.HORUS_INTERVIEW_COACH_MCP_SECRET?.trim();
    return {
      label: 'interview_coach',
      url: explicitUrl,
      ...(secret && { headers: { Authorization: `Bearer ${secret}` } }),
    };
  }

  const playgroundRaw = process.env.PLAYGROUND_MCP_SERVERS;
  if (playgroundRaw) {
    try {
      const entries = JSON.parse(playgroundRaw) as Array<{
        label: string;
        url: string;
        secretEnv?: string;
      }>;
      const match = entries.find(
        (e) =>
          (e.label === 'interview_coach' || e.label === 'interview-coach') &&
          /^https?:\/\//i.test(e.url),
      );
      if (match) {
        const secret = match.secretEnv ? process.env[match.secretEnv] : undefined;
        return {
          label: 'interview_coach',
          url: match.url,
          ...(secret && { headers: { Authorization: `Bearer ${secret}` } }),
        };
      }
    } catch {
      // Ignore malformed env JSON.
    }
  }

  return null;
}

async function computeTenantIndexStats(
  tenantId: string,
  collectionId: string | null,
): Promise<MarketplaceIndexStats> {
  const docWhere = {
    tenantId,
    status: 'INDEXED' as const,
    ...(collectionId && { collectionId }),
  };

  if (collectionId) {
    const docs = await prisma.document.findMany({
      where: docWhere,
      select: { id: true, category: true, chunksCount: true },
    });
    const docIds = docs.map((d) => d.id);
    const categories = [
      ...new Set(docs.map((d) => d.category).filter((c): c is string => Boolean(c))),
    ].sort();
    const chunks = docs.reduce((sum, d) => sum + d.chunksCount, 0);
    const entities =
      docIds.length > 0
        ? await prisma.entity.count({
            where: { tenantId, documents: { some: { documentId: { in: docIds } } } },
          })
        : 0;
    const relationships =
      docIds.length > 0
        ? await prisma.relationship.count({
            where: {
              tenantId,
              fromEntity: { documents: { some: { documentId: { in: docIds } } } },
              toEntity: { documents: { some: { documentId: { in: docIds } } } },
            },
          })
        : 0;
    return {
      documents: docs.length,
      chunks,
      entities,
      relationships,
      categories,
    };
  }

  const [documents, chunkAgg, entities, relationships, grouped] = await Promise.all([
    prisma.document.count({ where: docWhere }),
    prisma.document.aggregate({ where: docWhere, _sum: { chunksCount: true } }),
    prisma.entity.count({ where: { tenantId } }),
    prisma.relationship.count({ where: { tenantId } }),
    prisma.document.groupBy({
      by: ['category'],
      where: docWhere,
    }),
  ]);

  return {
    documents,
    chunks: chunkAgg._sum.chunksCount ?? 0,
    entities,
    relationships,
    categories: grouped
      .map((g) => g.category)
      .filter((c): c is string => Boolean(c))
      .sort(),
  };
}

async function installCountsBySlug(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const grouped = await prisma.marketplaceInstall.groupBy({
      by: ['listingSlug'],
      where: { enabled: true },
      _count: true,
    });
    for (const row of grouped) {
      map.set(row.listingSlug, row._count);
    }
  } catch (err) {
    if (!isMissingMarketplaceTable(err)) throw err;
  }
  return map;
}

async function buildFirstPartyCatalog(
  installs: Map<string, number>,
): Promise<MarketplaceCatalogItem[]> {
  const defaultCorpusSlug = process.env.HORUS_DEFAULT_INDEX_TENANT?.trim() || 'careercraft';
  const corpusTenant = await prisma.tenant
    .findUnique({ where: { slug: defaultCorpusSlug } })
    .catch(() => null);

  let careercraftStats: MarketplaceIndexStats = {
    documents: 94,
    chunks: 14820,
    entities: 1240,
    relationships: 3180,
    categories: [
      'budget',
      'budget-federal',
      'career-guidance',
      'education',
      'inclusion',
      'industry',
      'jobs-skills',
      'workforce',
    ],
  };
  let careercraftLive = false;

  if (corpusTenant?.isActive) {
    const liveStats = await computeTenantIndexStats(corpusTenant.id, null).catch(() => null);
    if (liveStats && liveStats.documents > 0) {
      careercraftStats = liveStats;
      careercraftLive = true;
    } else {
      careercraftLive = true;
    }
  }

  const coachRef = resolveInterviewCoachUpstream();
  let coachTools = FALLBACK_COACH_TOOLS;
  let coachLive = false;
  if (coachRef) {
    try {
      const discovered = await listMcpTools(coachRef);
      if (discovered.length > 0) {
        coachTools = discovered.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      }
      coachLive = true;
    } catch {
      coachLive = false;
    }
  }

  return [
    {
      id: 'fp-careercraft-index',
      slug: 'careercraft-index',
      name: 'Australian Policy, Budget & Workforce Index',
      tagline:
        'Grounded hybrid search and entity graph across Australian federal & state budgets, skills, TAFE, and workforce policy.',
      description:
        'Curated public-policy and labour-market intelligence corpus maintained by Horus. Every query returns verbatim cited passages with page numbers and official source links, backed by an extracted entity-relationship graph covering programs, agencies, funding streams, occupations, and qualifications.',
      kind: 'INDEX',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      category: 'government-policy',
      tags: ['australia', 'budgets', 'skills', 'workforce', 'knowledge-graph', 'citations'],
      samplePrompts: [
        'What skills and training funding was announced in the SA 2026-27 State Budget?',
        'How does Fee-Free TAFE connect to clean energy and defence workforce programs?',
        'Look up TAFE SA in the knowledge graph and list its funding relationships.',
      ],
      minPlan: 'FREE',
      verified: true,
      featured: true,
      firstParty: true,
      publisherName: 'Horus Official',
      publisherTenantId: corpusTenant?.id ?? null,
      collectionId: null,
      connectionId: null,
      live: careercraftLive,
      tools: INDEX_MCP_TOOLS,
      stats: careercraftStats,
      installCount: installs.get('careercraft-index') ?? 0,
      mcpPath: '/api/mcp/careercraft-index',
      restPath: '/api/v1/marketplace/careercraft-index/query',
    },
    {
      id: 'fp-interview-coach',
      slug: 'interview-coach',
      name: 'Interview Coach & Role Research MCP',
      tagline:
        'Stateless MCP tool server for live company research, study plans, calibrated interview loops, and rubric evaluation.',
      description:
        'The MCP engine powering Faircopy Interview Coach, exposed behind Horus API-key authentication and usage metering. Connect directly from Cursor, Claude Desktop, Windsurf, or attach in one click to any Horus workspace agent.',
      kind: 'MCP',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      category: 'career-ai',
      tags: ['mcp', 'interviews', 'role-research', 'study-guides', 'scoring'],
      samplePrompts: [
        'Research Atlassian engineering culture and backend interview focus areas.',
        'Generate a structured 7-day study guide for a Staff Systems Engineer interview.',
      ],
      minPlan: 'FREE',
      verified: true,
      featured: true,
      firstParty: true,
      publisherName: 'Horus Official',
      publisherTenantId: null,
      collectionId: null,
      connectionId: null,
      live: coachLive,
      tools: coachTools,
      installCount: installs.get('interview-coach') ?? 0,
      mcpPath: '/api/mcp/interview-coach',
      restPath: '/api/v1/marketplace/interview-coach/query',
    },
    {
      id: 'fp-workspace-bridge',
      slug: 'workspace',
      name: 'Workspace Knowledge & Graph Bridge',
      tagline:
        'Mount your own Horus documents, collections, and knowledge graph inside Cursor, Claude Desktop, or any external platform.',
      description:
        'Every Horus workspace automatically gets a dedicated Streamable-HTTP MCP server and REST v1 endpoint scoped to your tenant API key. Query your full workspace or pass `?collection=<slug>` to expose a single isolated knowledge silo to an external app.',
      kind: 'INDEX',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      category: 'developer-tools',
      tags: ['workspace', 'mcp-bridge', 'rag', 'knowledge-graph', 'collections', 'multi-tenant'],
      samplePrompts: [
        'Search my workspace documents for our latest compliance policy.',
        'Traverse our workspace knowledge graph for key program relationships.',
      ],
      minPlan: 'FREE',
      verified: true,
      featured: true,
      firstParty: true,
      publisherName: 'Horus Platform',
      publisherTenantId: null,
      collectionId: null,
      connectionId: null,
      live: true,
      tools: INDEX_MCP_TOOLS,
      installCount: installs.get('workspace') ?? 0,
      mcpPath: '/api/mcp/workspace',
      restPath: '/api/v1/marketplace/workspace/query',
    },
  ];
}

async function hydrateDbListing(
  row: {
    id: string;
    slug: string;
    name: string;
    tagline: string;
    description: string;
    kind: 'INDEX' | 'MCP';
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    visibility: 'PUBLIC' | 'UNLISTED';
    category: string;
    tags: string[];
    samplePrompts: string[];
    minPlan: Plan;
    verified: boolean;
    featured: boolean;
    publisherTenantId: string | null;
    publisherName: string;
    collectionId: string | null;
    connectionId: string | null;
    upstreamEndpoint: string | null;
  },
  installs: Map<string, number>,
  probeLiveMcp: boolean,
): Promise<MarketplaceCatalogItem> {
  if (row.kind === 'INDEX') {
    const stats = row.publisherTenantId
      ? await computeTenantIndexStats(row.publisherTenantId, row.collectionId).catch(
          () => undefined,
        )
      : undefined;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      description: row.description,
      kind: 'INDEX',
      status: row.status,
      visibility: row.visibility,
      category: row.category,
      tags: row.tags,
      samplePrompts: row.samplePrompts,
      minPlan: row.minPlan,
      verified: row.verified,
      featured: row.featured,
      firstParty: row.publisherTenantId === null,
      publisherName: row.publisherName,
      publisherTenantId: row.publisherTenantId,
      collectionId: row.collectionId,
      connectionId: null,
      live: Boolean(stats && stats.documents > 0),
      tools: INDEX_MCP_TOOLS,
      ...(stats && { stats }),
      installCount: installs.get(row.slug) ?? 0,
      mcpPath: `/api/mcp/${row.slug}`,
      restPath: `/api/v1/marketplace/${row.slug}/query`,
    };
  }

  let tools: MarketplaceToolSpec[] = [];
  let live = false;

  if (row.connectionId && row.publisherTenantId) {
    const conn = await prisma.connection
      .findFirst({
        where: { id: row.connectionId, tenantId: row.publisherTenantId, kind: 'MCP' },
      })
      .catch(() => null);
    if (conn) {
      const cached = Array.isArray(conn.tools)
        ? (conn.tools as Array<{ name?: string; description?: string }>)
        : [];
      tools = cached
        .filter((t): t is { name: string; description?: string } => typeof t?.name === 'string')
        .map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: { type: 'object', properties: {} },
        }));
      const endpointBlocked = Boolean(blockedUrlReason(conn.endpoint));
      const insecureTransport =
        process.env.NODE_ENV === 'production' &&
        !conn.endpoint.toLowerCase().startsWith('https://');
      const secretRefBlocked = Boolean(conn.secretRef && !isAllowedTenantSecretRef(conn.secretRef));
      live =
        conn.status === 'CONNECTED' && !endpointBlocked && !insecureTransport && !secretRefBlocked;
    }
  } else if (
    row.upstreamEndpoint &&
    !blockedUrlReason(row.upstreamEndpoint) &&
    (process.env.NODE_ENV !== 'production' ||
      row.upstreamEndpoint.toLowerCase().startsWith('https://'))
  ) {
    live = true;
    if (probeLiveMcp) {
      try {
        const discovered = await listMcpTools({
          label: row.slug.replace(/-/g, '_'),
          url: row.upstreamEndpoint,
        });
        tools = discovered.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch {
        live = false;
      }
    }
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    kind: 'MCP',
    status: row.status,
    visibility: row.visibility,
    category: row.category,
    tags: row.tags,
    samplePrompts: row.samplePrompts,
    minPlan: row.minPlan,
    verified: row.verified,
    featured: row.featured,
    firstParty: row.publisherTenantId === null,
    publisherName: row.publisherName,
    publisherTenantId: row.publisherTenantId,
    collectionId: null,
    connectionId: row.connectionId,
    live,
    tools,
    installCount: installs.get(row.slug) ?? 0,
    mcpPath: `/api/mcp/${row.slug}`,
    restPath: `/api/v1/marketplace/${row.slug}/query`,
  };
}

/**
 * List public published marketplace offerings (first-party + DB-published).
 */
export async function listMarketplaceCatalog(opts?: {
  kind?: MarketplaceListingKind;
  category?: string;
  search?: string;
  includeTenantDraftsFor?: string;
}): Promise<MarketplaceCatalogItem[]> {
  const installs = await installCountsBySlug();
  const firstParty = await buildFirstPartyCatalog(installs);
  const bySlug = new Map<string, MarketplaceCatalogItem>(firstParty.map((i) => [i.slug, i]));

  try {
    const dbRows = await prisma.marketplaceListing.findMany({
      where: opts?.includeTenantDraftsFor
        ? {
            OR: [
              {
                status: 'PUBLISHED',
                visibility: 'PUBLIC',
                publisherTenant: { is: { isActive: true } },
              },
              { status: 'PUBLISHED', visibility: 'PUBLIC', publisherTenantId: null },
              { publisherTenantId: opts.includeTenantDraftsFor },
            ],
          }
        : {
            status: 'PUBLISHED',
            visibility: 'PUBLIC',
            OR: [{ publisherTenantId: null }, { publisherTenant: { is: { isActive: true } } }],
          },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    const hydrated = await Promise.all(dbRows.map((row) => hydrateDbListing(row, installs, false)));
    for (const item of hydrated) {
      bySlug.set(item.slug, item);
    }
  } catch (err) {
    if (!isMissingMarketplaceTable(err)) throw err;
  }

  let items = [...bySlug.values()];
  if (opts?.kind) {
    items = items.filter((i) => i.kind === opts.kind);
  }
  if (opts?.category) {
    items = items.filter((i) => i.category === opts.category);
  }
  if (opts?.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    items = items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.tagline.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)) ||
        i.tools.some((t) => t.name.toLowerCase().includes(q)),
    );
  }

  return items;
}

/**
 * Fetch a single marketplace catalog item by slug (includes UNLISTED published items).
 */
export async function getMarketplaceCatalogItem(
  slug: string,
  opts?: { viewerTenantId?: string },
): Promise<MarketplaceCatalogItem | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;

  const installs = await installCountsBySlug();

  try {
    const row = await prisma.marketplaceListing.findUnique({
      where: { slug: clean },
      include: { publisherTenant: { select: { isActive: true } } },
    });
    if (row) {
      const ownerViewing = Boolean(
        opts?.viewerTenantId && row.publisherTenantId === opts.viewerTenantId,
      );
      const publisherActive =
        row.publisherTenantId === null || Boolean(row.publisherTenant?.isActive);
      if (!publisherActive) return null;
      if (row.status !== 'PUBLISHED' && !ownerViewing) return null;
      return hydrateDbListing(row, installs, true);
    }
  } catch (err) {
    if (!isMissingMarketplaceTable(err)) throw err;
  }

  const firstParty = await buildFirstPartyCatalog(installs);
  return firstParty.find((i) => i.slug === clean) ?? null;
}

async function resolveCollectionScope(
  tenantId: string,
  collectionId: string,
): Promise<{ sourceIds: string[]; documentIds: string[] }> {
  const docs = await prisma.document.findMany({
    where: { tenantId, collectionId, status: 'INDEXED' },
    select: { id: true, metadata: true },
  });
  const sourceIds = docs
    .map((d) => (d.metadata as { sourceId?: string } | null)?.sourceId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return {
    // Same safety invariant as /api/agent/chat: empty collection must match zero chunks, never whole corpus.
    sourceIds: sourceIds.length > 0 ? sourceIds : ['__no_documents__'],
    documentIds: docs.map((d) => d.id),
  };
}

/**
 * Resolve a slug into an executable backend target (never expose this raw object over HTTP).
 */
export async function resolveMarketplaceTarget(params: {
  slug: string;
  callerTenantId: string;
  /** Optional `?collection=<slug>` when querying `workspace`. */
  collectionSlug?: string | null;
}): Promise<ResolvedMarketplaceTarget | null> {
  const cleanSlug = params.slug.trim().toLowerCase();

  // 1. Caller's own workspace bridge (`/api/mcp/workspace`)
  if (cleanSlug === 'workspace') {
    const callerTenant = await prisma.tenant.findUnique({
      where: { id: params.callerTenantId },
    });
    if (!callerTenant?.isActive) return null;

    let collectionId: string | null = null;
    let sourceIds: string[] | undefined;
    let documentIds: string[] | undefined;

    if (params.collectionSlug) {
      const coll = await prisma.knowledgeCollection.findUnique({
        where: {
          tenantId_slug: {
            tenantId: callerTenant.id,
            slug: params.collectionSlug.trim().toLowerCase(),
          },
        },
      });
      if (!coll) return null;
      collectionId = coll.id;
      const scope = await resolveCollectionScope(callerTenant.id, coll.id);
      sourceIds = scope.sourceIds;
      documentIds = scope.documentIds;
    }

    const stats = await computeTenantIndexStats(callerTenant.id, collectionId).catch(
      () => undefined,
    );
    const installs = await installCountsBySlug();
    const firstParty = await buildFirstPartyCatalog(installs);
    const baseListing = firstParty.find((i) => i.slug === 'workspace')!;

    return {
      kind: 'INDEX',
      listing: {
        ...baseListing,
        name: `${callerTenant.name} · Workspace Index`,
        publisherTenantId: callerTenant.id,
        publisherName: callerTenant.name,
        collectionId,
        ...(stats && { stats }),
      },
      targetTenantId: callerTenant.id,
      collectionId,
      ...(sourceIds && { sourceIds }),
      ...(documentIds && { documentIds }),
    };
  }

  // 2. Database-published listing (takes precedence if present)
  try {
    const row = await prisma.marketplaceListing.findUnique({
      where: { slug: cleanSlug },
      include: { publisherTenant: { select: { id: true, isActive: true } } },
    });

    if (row) {
      const isOwner = row.publisherTenantId === params.callerTenantId;
      if (row.status !== 'PUBLISHED' && !isOwner) return null;
      if (row.publisherTenantId && !row.publisherTenant?.isActive) return null;

      const installs = await installCountsBySlug();
      const listing = await hydrateDbListing(row, installs, false);

      if (row.kind === 'INDEX') {
        if (!row.publisherTenantId) return null;
        if (row.collectionId) {
          const coll = await prisma.knowledgeCollection.findFirst({
            where: { id: row.collectionId, tenantId: row.publisherTenantId },
          });
          if (!coll) return null;
          const scope = await resolveCollectionScope(row.publisherTenantId, coll.id);
          return {
            kind: 'INDEX',
            listing,
            targetTenantId: row.publisherTenantId,
            collectionId: coll.id,
            sourceIds: scope.sourceIds,
            documentIds: scope.documentIds,
          };
        }
        return {
          kind: 'INDEX',
          listing,
          targetTenantId: row.publisherTenantId,
          collectionId: null,
        };
      }

      // row.kind === 'MCP'
      let serverRef: McpServerRef | null = null;
      const safeLabel = row.slug.replace(/[^a-z0-9_]/g, '_').slice(0, 31);

      if (row.connectionId && row.publisherTenantId) {
        const conn = await prisma.connection.findFirst({
          where: {
            id: row.connectionId,
            tenantId: row.publisherTenantId,
            kind: 'MCP',
            status: { not: 'DISABLED' },
          },
        });
        if (conn) {
          const ssrfReason = blockedUrlReason(conn.endpoint);
          const insecureTransport =
            process.env.NODE_ENV === 'production' &&
            !conn.endpoint.toLowerCase().startsWith('https://');
          if (!ssrfReason && !insecureTransport) {
            const canUseSecret = isAllowedTenantSecretRef(conn.secretRef);
            const secret =
              conn.authType === 'bearer' && conn.secretRef && canUseSecret
                ? process.env[conn.secretRef]
                : undefined;
            serverRef = {
              label: safeLabel,
              url: conn.endpoint,
              ...(secret && { headers: { Authorization: `Bearer ${secret}` } }),
            };
          }
        }
      } else if (row.upstreamEndpoint) {
        const ssrfReason = blockedUrlReason(row.upstreamEndpoint);
        const insecureTransport =
          process.env.NODE_ENV === 'production' &&
          !row.upstreamEndpoint.toLowerCase().startsWith('https://');
        if (!ssrfReason && !insecureTransport) {
          serverRef = {
            label: safeLabel,
            url: row.upstreamEndpoint,
          };
        }
      }

      return {
        kind: 'MCP',
        listing,
        serverRef,
      };
    }
  } catch (err) {
    if (!isMissingMarketplaceTable(err)) throw err;
  }

  // 3. Built-in first-party listings
  const installs = await installCountsBySlug();
  const firstParty = await buildFirstPartyCatalog(installs);
  const fp = firstParty.find((i) => i.slug === cleanSlug);
  if (!fp) return null;

  if (fp.slug === 'careercraft-index') {
    const defaultCorpusSlug = process.env.HORUS_DEFAULT_INDEX_TENANT?.trim() || 'careercraft';
    const corpusTenant = await prisma.tenant.findUnique({ where: { slug: defaultCorpusSlug } });
    if (!corpusTenant?.isActive) {
      return {
        kind: 'INDEX',
        listing: fp,
        targetTenantId: '',
        collectionId: null,
        sourceIds: ['__no_documents__'],
        documentIds: [],
      };
    }
    return {
      kind: 'INDEX',
      listing: fp,
      targetTenantId: corpusTenant.id,
      collectionId: null,
    };
  }

  if (fp.slug === 'interview-coach') {
    return {
      kind: 'MCP',
      listing: fp,
      serverRef: resolveInterviewCoachUpstream(),
    };
  }

  return null;
}

/**
 * List slugs currently installed & enabled on a tenant workspace.
 */
export async function listInstalledMarketplaceSlugs(tenantId: string): Promise<string[]> {
  try {
    const rows = await prisma.marketplaceInstall.findMany({
      where: { tenantId, enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { listingSlug: true },
    });
    return rows.map((r) => r.listingSlug);
  } catch (err) {
    if (isMissingMarketplaceTable(err)) return [];
    throw err;
  }
}

export interface InstalledMarketplaceIndex {
  slug: string;
  label: string;
  name: string;
  targetTenantId: string;
  sourceIds?: string[];
}

/**
 * Resolve all enabled Marketplace installs for a workspace into ready-to-attach
 * MCP tool servers and cross-tenant read-only knowledge indexes.
 */
export async function resolveInstalledMarketplaceAttachments(
  tenantId: string,
  callerPlan: MarketplacePlan,
): Promise<{
  mcpServers: McpServerRef[];
  indexes: InstalledMarketplaceIndex[];
}> {
  const slugs = await listInstalledMarketplaceSlugs(tenantId);
  if (slugs.length === 0) return { mcpServers: [], indexes: [] };

  const mcpServers: McpServerRef[] = [];
  const indexes: InstalledMarketplaceIndex[] = [];

  for (const slug of slugs) {
    if (slug === 'workspace') continue; // workspace is already the agent's primary corpus
    const target = await resolveMarketplaceTarget({ slug, callerTenantId: tenantId });
    if (!target) continue;
    if (!meetsPlan(callerPlan, target.listing.minPlan)) continue;

    if (target.kind === 'MCP' && target.serverRef) {
      mcpServers.push(target.serverRef);
    } else if (target.kind === 'INDEX' && target.targetTenantId) {
      // Avoid duplicating if the publisher installed their own full workspace index
      if (target.targetTenantId === tenantId && !target.collectionId) continue;
      indexes.push({
        slug: target.listing.slug,
        label: target.listing.slug.replace(/[^a-z0-9_]/g, '_').slice(0, 36),
        name: target.listing.name,
        targetTenantId: target.targetTenantId,
        ...(target.sourceIds && { sourceIds: target.sourceIds }),
      });
    }
  }

  return { mcpServers, indexes };
}
