# Horus Platform — Master Build Plan

> The intelligence layer enterprises don't want to build.
> Standalone product. Multi-tenant. White-labelable. SDK-exportable.

---

## 1. Executive Summary

Horus is a **standalone B2B intelligence platform** that productizes the hard parts of applied AI: hybrid RAG, knowledge graphs, entity extraction, document intelligence, contradiction detection, and proactive alerting.

We're building it as a **full T3 stack application** (Next.js + tRPC + Prisma + Tailwind) on top of **Supabase** (auth, storage, Postgres). On top of the application we ship `@horus/sdk` — a thin, type-safe client generated from the tRPC router that any consumer can install.

This gives us **three product surfaces from one codebase**:

1. **Hosted SaaS** — `app.horus.ai`, multi-tenant, subscription-billed.
2. **White-label / dedicated tenant** — custom domain, branding, optionally dedicated DB/instance for enterprise.
3. **SDK** — `npm install @horus/sdk` for developers embedding Horus capabilities into their own apps (this is how CareerCraft consumes it).

**Why now:** Every mid-market enterprise wants RAG + knowledge graphs over their docs, but the full stack (vector DB + graph DB + entity extraction + reranking + agentic reasoning + tenancy + auth + observability) takes a senior team 6–12 months to build. We're delivering it as a product.

**Existing leverage:** ~80% of the hard infrastructure already exists in the careercraft-pages monorepo: 9 Azure Functions, 14 Supabase Edge Functions, Bicep IaC, an enterprise web scraper, a populated Azure AI Search index, a Cosmos DB graph, and a working SDK skeleton. This plan is a **migration + productization** plan, not a greenfield build.

---

## 2. Vision

> *Horus is an accident I'm making intentional. The accident was building real intelligence infrastructure in service of CareerCraft. The intentional part is realizing that infrastructure is the product.*

**3-year goal:** the default intelligence layer for any vertical SaaS that needs to reason over a domain corpus.

**1-year goal:** 10 paying tenants (mix of self-serve Pro + 2–3 white-label enterprise) on shared infra, plus CareerCraft as the flagship reference customer.

**Positioning:** "Stripe for domain intelligence." You bring your documents and your domain; we bring the retrieval, reasoning, and graph layer.

---

## 3. Product Surface — What Horus Does

| Capability | What it actually does | Status |
|---|---|---|
| **Hybrid RAG** | Vector + keyword + semantic reranking over tenant's corpus | Built (Azure Func `rag-metadata`) |
| **Agentic RAG** | Decomposes query → executes plan → synthesizes | Built (Azure Func `agentic-planner`) |
| **Conversational RAG** | Session-memory chat over corpus | Built (Supabase Func `rag-chat`) |
| **Knowledge Graph** | Entity + relationship store with traversal & contradiction detection | Built (Cosmos Gremlin + `graph-query` func) |
| **Document Intelligence** | PDF parse → chunk → embed → tag → entity-extract → chart-extract | Built (Azure Funcs: pdf-upload, chart-extraction, entity-extraction) |
| **Intersection Reasoning** | Find contradictions, gaps, connections across multi-doc results | Built (Azure Func `intersection-reasoning`) |
| **Proactive Alerts** | Anomaly detection over time-series intelligence | Built (Azure Func `proactive-impact-alerts`) |
| **Web Ingestion** | Scheduled crawl → transform → index | Built (`infrastructure/web-scraper/enterprise-scraper`) |
| **Tenant Admin** | Prompt management, usage analytics, audit trail, API keys | Partial (CC admin pages migrate over) |
| **Custom Vertical Modules** | Drop-in domain modules (careers, policy, finance, legal…) | New — first module is "Careers" extracted from CC |

---

## 4. Architecture

### 4.1 High-level

```
┌────────────────────────────────────────────────────────────┐
│                       horus-platform                        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js App Router  (web + admin + tenant portal)   │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │              tRPC Router Surface                     │  │
│  │  rag · agentic · graph · documents · entities ·      │  │
│  │  intelligence · admin · billing · webhooks           │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │           Server Services (lib/server)               │  │
│  │  hybridSearch · agenticPlanner · gremlinClient ·     │  │
│  │  pdfPipeline · entityExtractor · alertEngine ·       │  │
│  │  scraperJobs · intersectionReasoner · billingMeter   │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │                  Data Plane                          │  │
│  │  Supabase (Postgres + Auth + Storage + Realtime)     │  │
│  │  Prisma (typed access to same Postgres)              │  │
│  │  Azure AI Search (vector + keyword index)            │  │
│  │  Cosmos DB / Neo4j (graph)                           │  │
│  │  Azure Blob Storage (raw documents)                  │  │
│  │  Upstash Redis (cache + rate limit + queue)          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Heavy/async work runs on Azure Container Apps             │
│  (PDF processing, scraping, alerting, graph backfill)      │
└────────────────────────────────────────────────────────────┘
                           │
                           │  @horus/sdk  (tRPC client)
                           ▼
                  Consumer apps
                  (CareerCraft, B2B customers)
```

### 4.2 Why a single Next.js app, not microservices

The earlier separation plan called for 6 Dockerized microservices behind a gateway. We're collapsing that into **one Next.js app with workers**:

- **Faster iteration.** One deploy, one type system, one repo.
- **Tenancy is uniform.** Multi-tenant middleware lives in one place.
- **Cold-start economics.** Microservices on Container Apps are fine but introduce 6× the deployment surface and cross-service typing pain for a 1-person team.
- **Heavy work goes to workers, not separate services.** PDF parsing, graph backfill, scraping — those run as **background jobs** (Azure Container Apps jobs / Inngest / Trigger.dev), not as always-on microservices.

We can split a service out *if and when* a single capability genuinely needs to scale independently or be sold separately. Premature decomposition is the most common way these projects die.

### 4.3 Background workers (separate, but managed)

| Workload | Runtime | Trigger |
|---|---|---|
| PDF parse + embed pipeline | Azure Container App Job | Storage event when blob uploaded |
| Web scraper | Azure Container App Job | Cron (every 6h) |
| Graph backfill / dedup | Azure Container App Job | Cron (nightly) |
| Alert evaluation | Azure Container App Job | Cron (hourly) |
| Email notifications | Resend / Supabase Function | tRPC mutation |

These are **not** services consumed by the SDK. They're internal pipelines. The SDK only ever talks to the tRPC surface.

---

## 5. Tech Stack — Decisions & Rationale

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | Server components + RSC streaming + edge runtime where useful. Standard. |
| API | **tRPC v11** | Type-safe end-to-end, free SDK by re-exporting client. Beats REST+codegen. |
| ORM | **Prisma** | Best-in-class types. Connects to Supabase Postgres directly. |
| DB | **Supabase Postgres** | Auth + Storage + Realtime + pgvector + RLS in one. Kept from existing infra. |
| Auth | **Supabase Auth** | Already wired in CareerCraft. Saves 2+ weeks rebuilding email/social/magic-link. |
| Tenant API auth | **Custom API key system** (Prisma table + bcrypt) | Required for SDK consumers; Supabase Auth alone doesn't fit non-user callers. |
| Vector search | **Azure AI Search** | Existing index, ~600 docs already embedded. pgvector as future fallback. |
| Graph | **Azure Cosmos DB (Gremlin)** | Existing. Neo4j VM ready as alternative if Cosmos costs spike. |
| Object storage | **Azure Blob** + **Supabase Storage** | Blob for raw PDFs (existing), Supabase for tenant-uploaded UI assets. |
| Cache + rate limit | **Upstash Redis** | Serverless, per-request pricing, fits Vercel edge. |
| Background jobs | **Inngest** OR **Azure Container Apps Jobs** | Inngest for ergonomics; Container Apps for heavy/long workloads. |
| Email | **Resend** | DX, deliverability, React email templates. |
| Billing | **Stripe** + **Stripe Customer Portal** | Subscription + metered usage. |
| Observability | **Axiom** + **Sentry** + **OpenTelemetry** | Logs + errors + traces. |
| Deployment | **Vercel** (web) + **Azure Container Apps** (workers) | Web stays on Vercel for DX; heavy compute on Azure where the data lives. |
| Monorepo | **Turborepo + pnpm** | Existing repo uses turbo+npm; switching to pnpm for workspace performance. |
| Testing | **Vitest** + **Playwright** | Unit + e2e. |
| CI | **GitHub Actions** | Standard. |
| IaC | **Bicep** (existing) + **Terraform** (new bits) | Don't rewrite working Bicep; new bits go in Terraform if Bicep doesn't fit. |

### 5.1 Notably *not* using

- **NextAuth / Auth.js** — Supabase Auth covers this. No need for two auth systems.
- **Separate microservices** — see §4.2.
- **Custom API gateway (APIM, Kong)** — tRPC + Vercel handles routing, rate limit done in Redis middleware.
- **Redux / Zustand for app state** — TanStack Query (built into tRPC) covers it.
- **GraphQL** — tRPC gives the same type-safety with less ceremony for our use case.

---

## 6. Multi-Tenancy & White-Label Model

### 6.1 Tenancy isolation strategy

**Shared schema, row-level isolation** (default, all customers):
- Every domain table has `tenantId UUID NOT NULL`.
- Postgres RLS policies enforce isolation at DB level.
- tRPC middleware injects `tenantId` from the authed user/API key into every request context.
- Prisma queries automatically scoped via `prisma.$extends({ query: ... })`.

**Dedicated schema** (white-label tier):
- Tenant gets their own Postgres schema (or full Supabase project for enterprise).
- Same code, different connection string per tenant resolved at request time.

**Self-hosted** (top-tier enterprise):
- Docker Compose / Helm chart deploys the full stack into the customer's Azure/AWS account.
- We provide updates via signed container images.

### 6.2 Tenant resolution

```
Request → Middleware reads:
  1. Subdomain  (acme.horus.ai)        → tenantId
  2. Custom domain (intel.acme.com)    → tenantId via domains table
  3. API key header (X-Horus-Key)      → tenantId via api_keys table
  4. Path prefix (/t/acme)             → tenantId (admin/dev only)
→ Context populated → tRPC procedures see ctx.tenantId
```

### 6.3 White-label config (per tenant)

Stored in `tenants.config JSONB`:

```jsonc
{
  "branding": {
    "name": "Acme Intelligence",
    "logoUrl": "...",
    "faviconUrl": "...",
    "primaryColor": "#0F172A",
    "fontFamily": "Inter"
  },
  "domain": {
    "subdomain": "acme",
    "customDomain": "intel.acme.com",
    "verifiedAt": "2026-..."
  },
  "features": {
    "ragEnabled": true,
    "graphEnabled": true,
    "agenticEnabled": true,
    "alertsEnabled": false,
    "vertical": "policy"
  },
  "modelOverrides": {
    "completionModel": "gpt-4o",
    "embeddingModel": "text-embedding-3-large",
    "systemPromptOverride": "..."
  },
  "limits": {
    "queriesPerMonth": 50000,
    "documentsMax": 10000,
    "graphEntitiesMax": 100000
  }
}
```

Branding is applied at render time via Tailwind CSS variables + a `useTenantTheme()` hook. No rebuild required to white-label.

### 6.4 Custom versions ("vertical modules")

Each tenant can opt into one or more **vertical modules**. A module is a collection of:

- Pre-tuned system prompts for that domain
- Schema extensions (extra entity types, relationship types)
- Pre-built dashboards / pages
- Default scrapers / data sources
- Evaluation suites

Modules ship as `packages/modules/<name>` and tenants enable them via config. Initial modules:

- `careers` — extracted from CareerCraft (job market, skills, occupations)
- `policy` — government policy + funding intelligence (existing SA gov corpus)
- `generic` — vanilla RAG + graph, no domain bias

A new vertical = a new module. That's the productized customization layer.

---

## 7. SDK Strategy

### 7.1 The SDK is the tRPC client + ergonomics

```ts
// @horus/sdk
import { createHorusClient } from '@horus/sdk';

const horus = createHorusClient({
  apiKey: process.env.HORUS_API_KEY!,
  // tenantId implicit from API key
});

// All these are type-safe — types come from the server's tRPC router
const result = await horus.rag.query({ query: '...', filters: {...} });
const stream = horus.rag.chat.stream({ sessionId, message: '...' });
const graph  = await horus.graph.traverse({ entity: '...', depth: 3 });
```

### 7.2 SDK packages we ship

| Package | Purpose |
|---|---|
| `@horus/sdk` | Core TS client (server-safe, no React) |
| `@horus/sdk/react` | React hooks (`useRagQuery`, `useChat`, etc.) |
| `@horus/sdk/types` | Pure type re-exports (zero runtime) |
| `@horus/sdk/cli` | CLI for tenant admin (upload docs, manage keys) |

### 7.3 Backwards-compatibility

SDK versioning: **semver tied to API version**. We expose `/api/trpc/v1/*` and `/api/trpc/v2/*` to allow breaking changes without breaking existing SDK installs.

### 7.4 Open-sourcing the SDK?

Decision: **SDK is source-available** (Elastic License or similar). Server is closed. This is the Sentry / Supabase model — devs can read the client, run it locally, but can't fork the server.

---

## 8. Repo Structure

```
horus-platform/
├── apps/
│   ├── web/                       # Next.js: tenant portal + admin + marketing
│   │   ├── app/
│   │   │   ├── (marketing)/       # public landing
│   │   │   ├── (tenant)/[tenant]/ # tenant-scoped portal
│   │   │   ├── (admin)/admin/     # platform admin (us)
│   │   │   ├── api/trpc/[trpc]/   # tRPC handler
│   │   │   └── api/webhooks/      # Stripe, scraper callbacks
│   │   └── components/
│   └── docs/                      # Mintlify or Nextra dev-facing docs
├── packages/
│   ├── sdk/                       # @horus/sdk (TS client)
│   ├── sdk-react/                 # @horus/sdk/react hooks
│   ├── api/                       # tRPC routers (consumed by apps/web + sdk)
│   │   └── src/routers/
│   │       ├── rag.ts
│   │       ├── agentic.ts
│   │       ├── graph.ts
│   │       ├── documents.ts
│   │       ├── entities.ts
│   │       ├── intelligence.ts
│   │       ├── alerts.ts
│   │       ├── admin.ts
│   │       └── billing.ts
│   ├── core/                      # Domain logic — pure, no framework
│   │   └── src/
│   │       ├── rag/               # hybrid + agentic + reranker
│   │       ├── graph/             # gremlin client + traversal + contradictions
│   │       ├── documents/         # parse + chunk + embed
│   │       ├── entities/          # NER + resolver
│   │       ├── reasoning/         # intersection + plan execution
│   │       └── alerts/            # anomaly detection
│   ├── db/                        # Prisma schema + migrations + client
│   ├── auth/                      # Supabase auth helpers + API key system
│   ├── tenancy/                   # Tenant resolution + RLS helpers
│   ├── ui/                        # Shared shadcn components (themable)
│   ├── modules/                   # Vertical modules
│   │   ├── careers/
│   │   ├── policy/
│   │   └── generic/
│   └── config/                    # ESLint, TS, Tailwind shared configs
├── workers/                       # Background workers (Azure Container Apps Jobs)
│   ├── pdf-pipeline/              # ← from azure-functions/pdf-upload + chart + entity
│   ├── scraper/                   # ← from infrastructure/web-scraper
│   ├── graph-backfill/
│   └── alerts/                    # ← from azure-functions/proactive-impact-alerts
├── infrastructure/                # IaC (forked from existing)
│   ├── bicep/                     # Existing Azure infra (AI Search, Cosmos, OpenAI)
│   └── terraform/                 # New bits (Vercel, Upstash, Stripe webhooks)
├── scripts/
│   ├── migrate-from-careercraft.ts
│   └── seed-tenant.ts
├── e2e/                           # Playwright tests
├── .github/workflows/
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── PLAN.md                        # This file
├── README.md
└── ROADMAP.md
```

---

## 9. Database Design

### 9.1 Core tables (multi-tenant)

```prisma
// packages/db/prisma/schema.prisma

model Tenant {
  id            String   @id @default(uuid())
  slug          String   @unique          // acme
  name          String
  plan          Plan     @default(STARTER)
  config        Json                       // branding, features, limits
  customDomain  String?  @unique
  createdAt     DateTime @default(now())

  users         TenantUser[]
  apiKeys       ApiKey[]
  documents     Document[]
  entities      Entity[]
  chatSessions  ChatSession[]
  usage         UsageRecord[]
}

model TenantUser {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String                          // matches Supabase auth.users.id
  role      Role     @default(MEMBER)
  tenant    Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, userId])
  @@index([userId])
}

model ApiKey {
  id          String    @id @default(uuid())
  tenantId    String
  keyHash     String                       // bcrypt
  keyPrefix   String                       // horus_sk_live_abc... (first 12 chars for display)
  name        String
  scopes      String[]                     // ["rag:read", "graph:write"]
  rateLimit   Int       @default(100)      // per minute
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([tenantId])
  @@index([keyHash])
}

model Document {
  id          String   @id @default(uuid())
  tenantId    String
  title       String
  category    String?
  tags        String[]
  blobUrl     String
  status      DocStatus @default(PROCESSING)
  pageCount   Int?
  chunksCount Int?
  metadata    Json?
  createdAt   DateTime @default(now())

  chunks      Chunk[]
  entities    DocumentEntity[]

  @@index([tenantId, status])
}

model Chunk {
  id          String   @id @default(uuid())
  tenantId    String
  documentId  String
  ordinal     Int
  text        String
  searchId    String?                       // ID in Azure AI Search
  embedding   Unsupported("vector(3072)")?  // pgvector fallback
  pageNumber  Int?
  metadata    Json?

  document    Document @relation(fields: [documentId], references: [id])

  @@index([tenantId, documentId])
}

model Entity {
  id           String   @id @default(uuid())
  tenantId     String
  name         String
  type         String                       // organization, program, policy...
  graphNodeId  String?                      // Cosmos vertex ID
  metadata     Json?
  createdAt    DateTime @default(now())

  @@unique([tenantId, name, type])
  @@index([tenantId, type])
}

model ChatSession {
  id          String   @id @default(uuid())
  tenantId    String
  userId      String?                       // null for SDK-only callers
  context     String?                       // "career-coaching", "policy-research"
  metadata    Json?
  createdAt   DateTime @default(now())

  messages    ChatMessage[]

  @@index([tenantId, userId])
}

model ChatMessage {
  id          String   @id @default(uuid())
  sessionId   String
  role        MsgRole
  content     String
  sources     Json?
  tokensUsed  Int?
  createdAt   DateTime @default(now())

  session     ChatSession @relation(fields: [sessionId], references: [id])
  @@index([sessionId, createdAt])
}

model UsageRecord {
  id         String    @id @default(uuid())
  tenantId   String
  meter      String                        // queries, embeddings, documents
  quantity   Int
  apiKeyId   String?
  occurredAt DateTime  @default(now())

  @@index([tenantId, meter, occurredAt])
}

model Prompt {
  id         String   @id @default(uuid())
  tenantId   String?                       // null = platform default
  key        String                        // career-coach, policy-analyst
  template   String
  version    Int      @default(1)
  isActive   Boolean  @default(true)
  metadata   Json?

  @@unique([tenantId, key, version])
}

model AuditLog {
  id         String   @id @default(uuid())
  tenantId   String
  userId     String?
  apiKeyId   String?
  action     String
  resource   String?
  metadata   Json?
  ip         String?
  occurredAt DateTime @default(now())

  @@index([tenantId, occurredAt])
}
```

### 9.2 RLS

Every table enforces `tenant_id = current_setting('app.tenant_id')::uuid`. Set via Prisma middleware on every connection acquisition.

### 9.3 Graph store (Cosmos / Neo4j)

Stays separate. Each vertex/edge tagged with `tenantId` property. Server-side query layer enforces tenant filter on every gremlin/cypher query.

---

## 10. Auth & Security

### 10.1 Three auth modes

| Caller | Auth | Carries |
|---|---|---|
| End user (browser) | Supabase Auth (cookies/JWT) | `userId` → resolves `tenantId` via `TenantUser` |
| SDK / API | API Key (`Authorization: Bearer horus_sk_...`) | `tenantId` directly |
| Platform admin (us) | Supabase Auth + role claim | `userId` + `superadmin` |

### 10.2 API key format

`horus_sk_live_<24-char-random>` — `live` / `test` env distinction. Prefix stored in plain text for the dashboard ("show last 4"), full key bcrypt-hashed.

### 10.3 Per-key scopes

`rag:read`, `rag:write`, `graph:read`, `graph:write`, `documents:write`, `admin:*`. Scope check is a tRPC middleware run after auth.

### 10.4 Rate limiting

Upstash Redis sliding window — `key:{tenantId}:{minute}`. Default 100 req/min, overridable per-key.

### 10.5 Hardening checklist

- [ ] All tRPC procedures wrapped in tenant-scope middleware
- [ ] Prisma extension auto-injects `where: { tenantId }` (defense in depth on top of RLS)
- [ ] Audit log on every mutation
- [ ] Encrypted secrets via Azure Key Vault + Vercel env
- [ ] Input validation (Zod) on every router
- [ ] Output filtering for PII
- [ ] CORS allowlist per-tenant for SDK origins
- [ ] CSP / HSTS / security headers
- [ ] Per-tenant content limits (file size, query length, doc count)

---

## 11. Existing Asset Inventory (What We Already Have)

Before any code is written, this is the existing capability we're carrying over. The plan is **migration, not rebuild**.

### 11.1 Azure Functions (`careercraft-pages/azure-functions/`)

| Function | What it does | Migration target |
|---|---|---|
| `agentic-planner` | Decomposes complex queries into multi-step plans | `packages/core/src/reasoning/planner.ts` |
| `chart-extraction` | Extracts charts/tables from PDFs (Document Intelligence) | `workers/pdf-pipeline/extractors/charts.ts` |
| `entity-extraction` | NER over text → entity records | `workers/pdf-pipeline/extractors/entities.ts` + `packages/core/src/entities/` |
| `graph-query` | Gremlin queries against Cosmos DB | `packages/core/src/graph/gremlin.ts` |
| `intersection-reasoning` | Find contradictions/connections across results | `packages/core/src/reasoning/intersection.ts` |
| `pdf-renderer` | Containerized PDF rasterizer | `workers/pdf-pipeline/render/` (keep as Container App) |
| `pdf-upload` | PDF → blob → trigger pipeline | tRPC `documents.upload` mutation + worker trigger |
| `proactive-impact-alerts` | Periodic anomaly + alert generation | `workers/alerts/` |
| `rag-metadata` | Hybrid search + metadata + semantic search | `packages/core/src/rag/hybrid.ts` |

### 11.2 Supabase Edge Functions (`careercraft-pages/supabase/functions/`)

| Function | Migration target | Notes |
|---|---|---|
| `rag-chat` | tRPC `rag.chat` + streaming | Becomes a streaming tRPC procedure |
| `rag-metadata` | Already in Azure Func above | Edge wrapper, dropped |
| `rag-query` | tRPC `rag.query` | |
| `rag-extract-insights` | `packages/core/src/rag/insights.ts` | |
| `rag-tag-documents` | `workers/pdf-pipeline/tagger.ts` | |
| `agents` | `packages/core/src/reasoning/agents.ts` | |
| `generate-prompt` | `packages/core/src/prompts/` | |
| `parse-resume` | **CareerCraft-only** — stays in CareerCraft, not migrated |
| `ats-analyze` | **CareerCraft-only** — stays |
| `rewrite-resume` | **CareerCraft-only** — stays |
| `interview-ai` | **CareerCraft-only** — stays |
| `get-new-jobs` | `packages/modules/careers/` (vertical module) |
| `job-news` | `packages/modules/careers/` |
| `process-job-notifications` | `packages/modules/careers/` |
| `track-session` | tRPC `analytics.track` | Generic, kept |

### 11.3 Infrastructure (`careercraft-pages/infrastructure/`)

| Asset | Move | Notes |
|---|---|---|
| `bicep/main.bicep` | Copy to `horus-platform/infrastructure/bicep/` | Deploys AI Search, OpenAI, Cosmos, Blob, Doc Intelligence |
| `bicep/cosmos-graph.bicep` | Copy | Gremlin graph DB |
| `bicep/neo4j-vm.bicep` | Copy | Alternative graph backend |
| `web-scraper/enterprise-scraper/` | Copy → `workers/scraper/` | The crawler |
| `scripts/deploy-*.ps1` | Adapt → `scripts/` | Deployment scripts |
| `scripts/evaluate-rag-quality.ps1` | Copy | RAG eval suite |
| `RAG-training/*.pdf` | Move → `workers/scraper/seed-corpus/` | Existing 600+ doc training corpus |
| `docs/MULTI-TENANCY.md` | Reference for §6 design | |

### 11.4 Existing SDK skeleton (`packages/horus-sdk/`)

Already has `client.ts`, `agentic.ts`, `chat.ts`, `http.ts`, `streaming/`, `react.ts`, `types.ts`.
**Action:** rewrite as a thin tRPC client wrapper. Most of the existing code becomes redundant once tRPC types flow through. Keep streaming helpers and React hook ergonomics.

### 11.5 Database

Existing Supabase project has tenant-adjacent tables (`graph_entities`, `graph_relationships`, `chat_sessions`, `chat_prompts`, `documents`, `query_plans`, `prompt_cache`, `audit_logs`, `security_alerts`).
**Action:** Spin up new Supabase project for Horus, port schemas, run a one-time data migration to add `tenant_id` (default = "careercraft" tenant for existing rows).

---

## 12. Phased Build Plan

8 weeks to a public beta. 12 weeks to first paying enterprise tenant.

### Phase 0 — Foundation (Week 1)

**Goal:** Empty repo running with auth, DB, and a hello-world tRPC procedure.

- [ ] Init monorepo (pnpm + turbo)
- [ ] Create new Supabase project for Horus
- [ ] Wire Prisma → Supabase Postgres
- [ ] Bootstrap Next.js app with App Router
- [ ] Wire Supabase Auth (email + Google + magic link)
- [ ] Set up tRPC v11 with one `health.ping` procedure
- [ ] Tenant resolution middleware (subdomain + API key)
- [ ] Tenant schema in Prisma (`Tenant`, `TenantUser`, `ApiKey`)
- [ ] Seed script: create platform-admin tenant + first user
- [ ] CI: GitHub Actions running typecheck + lint + Prisma validate
- [ ] Deploy to Vercel (preview)

**Done when:** I can sign up, get assigned to a tenant, and call `trpc.health.ping()` from the browser AND from the SDK with a real API key.

### Phase 1 — RAG MVP (Weeks 2–3)

**Goal:** Tenant can upload a PDF, ask a question, get an answer.

- [ ] Port `rag-metadata` Azure Function logic into `packages/core/src/rag/hybrid.ts`
- [ ] Port `rag-query` into tRPC `rag.query` procedure
- [ ] Port `rag-chat` into tRPC `rag.chat` (streaming)
- [ ] Port `pdf-upload` + `pdf-renderer` + `chart-extraction` + `entity-extraction` into `workers/pdf-pipeline/`
- [ ] Build basic tenant portal: upload doc, see status, ask question
- [ ] Connect to existing Azure AI Search (new tenant-scoped index)
- [ ] Per-tenant document upload + storage in Azure Blob
- [ ] Basic SDK: `horus.rag.query`, `horus.rag.chat`, `horus.documents.upload`
- [ ] e2e test: upload doc → search → answer with citations

**Done when:** `pnpm test:e2e` passes the upload+query flow end-to-end, on a fresh tenant.

### Phase 2 — Graph + Agentic (Weeks 3–4)

**Goal:** The differentiated capabilities work.

- [ ] Port `graph-query` into `packages/core/src/graph/gremlin.ts`
- [ ] Port `agentic-planner` into `packages/core/src/reasoning/planner.ts`
- [ ] Port `intersection-reasoning` into `packages/core/src/reasoning/intersection.ts`
- [ ] tRPC routers: `graph.*`, `agentic.*`
- [ ] Tenant-scope every Cosmos query (vertex/edge `tenantId` property + filter)
- [ ] Graph viewer page in tenant portal (Cytoscape or Reaflow)
- [ ] Contradiction detection surface in chat UI

**Done when:** A complex multi-step query returns a synthesized answer with at least one detected contradiction or connection.

### Phase 3 — Multi-Tenant & White-Label (Week 5)

**Goal:** A new tenant can self-onboard and customize their instance.

- [ ] Tenant onboarding flow (sign up → name workspace → invite team)
- [ ] API key UI (create, scope, revoke, copy-once display)
- [ ] Branding config UI (logo, colors, favicon, name)
- [ ] Tenant theme provider applies branding at runtime via CSS vars
- [ ] Subdomain routing (`{slug}.horus.ai`) on Vercel
- [ ] Custom domain support (CNAME + verification + SSL via Vercel)
- [ ] Per-tenant feature flags

**Done when:** I can create a fresh tenant `acme`, give it a logo and color, route `acme.horus.ai` to it, and the dashboard reflects branding without a redeploy.

### Phase 4 — Billing + Limits (Week 6)

**Goal:** The product is sellable.

- [ ] Stripe integration: subscription plans (Starter / Pro / Enterprise)
- [ ] Usage metering: queries, documents, embeddings, graph entities
- [ ] Stripe metered billing webhook
- [ ] Customer portal link in tenant settings
- [ ] Limit enforcement middleware (block/warn at 80%, hard-block at 100%)
- [ ] Usage dashboard (real-time + monthly trend)

**Done when:** A test tenant can subscribe via Stripe checkout, hit a limit, and see correct billing in their portal.

### Phase 5 — Vertical Modules + CareerCraft Migration (Week 7)

**Goal:** First module shipped, CareerCraft consuming Horus via SDK.

- [ ] `packages/modules/careers/` extracted from CareerCraft logic
- [ ] `packages/modules/policy/` for SA gov / generic policy work
- [ ] Module enable/disable per tenant
- [ ] CareerCraft monorepo updated to consume `@horus/sdk` (npm linked locally first, published later)
- [ ] CC's RAG/agentic/graph code paths replaced with SDK calls
- [ ] CC tenant created in Horus, one-shot data migration script

**Done when:** CareerCraft works end-to-end calling Horus SDK with no direct DB or Azure Function access.

### Phase 6 — Admin, Observability, Ops (Week 8)

**Goal:** Production-readiness.

- [ ] Platform-admin portal: tenant list, usage, support tools
- [ ] Audit log UI per tenant
- [ ] Sentry + Axiom + OpenTelemetry tracing
- [ ] Status page (statuspage.io or simple hosted page)
- [ ] Runbooks (incident, data export, GDPR delete)
- [ ] Backups + restore drill (Supabase + Cosmos)
- [ ] Rate-limit + abuse detection alerts
- [ ] Security review (OWASP top-10 walkthrough on every router)

**Done when:** A 24-hour load test sustains 100 RPS across 3 tenants without errors, alerts fire on synthetic failures, restore drill recovers a deleted tenant within RTO.

### Phase 7 — Public Beta (Week 9)

- [ ] Marketing site live
- [ ] Docs site live (`docs.horus.ai`)
- [ ] Free trial flow ($0 / 14-day)
- [ ] First 5 design-partner tenants onboarded
- [ ] SDK published to npm (private scope first, public if we open-source)

### Phase 8 — Enterprise / White-label (Weeks 10–12)

- [ ] Dedicated-instance offering (separate Supabase project provisioning automation)
- [ ] Self-host Helm chart + Compose file
- [ ] SSO (SAML / OIDC) for enterprise tenants
- [ ] Audit log export
- [ ] SLA + DPA paperwork
- [ ] First paying enterprise tenant

---

## 13. Deployment

| Surface | Where | Why |
|---|---|---|
| `apps/web` | Vercel | DX, edge, preview envs |
| `apps/docs` | Vercel | Same |
| `workers/pdf-pipeline` | Azure Container App Job | Heavy, GPU-adjacent, lives near data |
| `workers/scraper` | Azure Container App Job | Long-running, scheduled |
| `workers/graph-backfill` | Azure Container App Job | Periodic |
| `workers/alerts` | Azure Container App Job | Hourly cron |
| Postgres | Supabase | Existing |
| Vector | Azure AI Search | Existing |
| Graph | Azure Cosmos DB | Existing |
| Blob | Azure Blob | Existing |
| Cache / queue | Upstash Redis | Serverless |
| Email | Resend | DX |
| Billing | Stripe | Standard |

### Environments

`local` → `preview` (PR previews via Vercel + ephemeral Supabase branches) → `staging` → `production`.

### Self-host bundle

`infrastructure/self-host/` ships:
- `docker-compose.yml` for local + small enterprise
- `helm/` chart for k8s deployments
- `terraform/` modules for cloud-native enterprise (AWS/Azure/GCP variants)

---

## 14. Cost Model

### Platform infra (us)

| Item | Monthly | Notes |
|---|---|---|
| Supabase (Pro) | $25 | DB + auth + storage |
| Vercel (Pro) | $20 | Web hosting |
| Azure AI Search (Basic) | $200 | Existing |
| Azure OpenAI | $50–200 | Variable on usage |
| Azure Doc Intelligence | $50–100 | Variable |
| Azure Cosmos DB | $25–50 | Variable |
| Azure Blob | $10 | Tiny |
| Azure Container Apps Jobs | $30–80 | Scale-to-zero workers |
| Upstash Redis | $10 | Serverless |
| Resend | $20 | 50k emails |
| Stripe | 2.9% + 30¢ | Per txn |
| Sentry / Axiom | $30 | Logs + errors |
| **Subtotal** | **$470–795** | Without first-tenant overhead |

### Per-tenant marginal cost

Mostly Azure OpenAI tokens (variable), AI Search index storage (~$5/GB/mo after first 2GB), Cosmos RU (~$25/100k entities). Roughly **$15–80/tenant/month** at active usage, recoverable at any tier above Starter.

### Pricing (proposed)

| Plan | Price | Limits | Margin |
|---|---|---|---|
| Free trial | $0 | 14 days, 100 queries, 10 docs | Loss leader |
| Starter | $99/mo | 1,000 queries, 100 docs, 500 graph entities | ~70% |
| Pro | $499/mo | 10,000 queries, 1,000 docs, 5,000 entities | ~80% |
| Scale | $1,999/mo | 50,000 queries, 10k docs, 50k entities, custom domain | ~85% |
| Enterprise | $5k–25k/mo | Custom, SLA, dedicated, SSO, self-host option | Negotiated |

---

## 15. Go-to-Market (Light)

This is the build plan, not the GTM doc, but worth flagging the mapping:

- **Wedge product:** CareerCraft is the reference customer + case study. "We built our own consumer SaaS on top of Horus in N weeks."
- **First 5 tenants:** Hand-picked design partners. Free Pro for 3 months in exchange for testimonials and product input. Targets: a policy think-tank, a recruitment SaaS, a small consultancy with a doc corpus, a GovTech vendor, an internal-knowledge-base SaaS.
- **Channel:** Dev-first. Tweet the SDK. "Add domain intelligence to your app in 50 lines." Examples repo. Show, don't tell.
- **Sales motion:** PLG up to Pro. Sales-assisted Scale+. Direct enterprise.

---

## 16. Open Questions / Decisions to Make

- [ ] **Brand name lock-in.** "Horus" is an internal name; check trademark + domain availability before public launch (`horus.ai`, `horusintel.com`, etc.).
- [ ] **SDK license.** Source-available (Elastic / BSL) vs. closed binary. Recommend source-available.
- [ ] **Graph backend.** Stay on Cosmos Gremlin (current) or migrate to Neo4j (existing VM is ready). Cosmos is more managed; Neo4j is better tooling. Decide in Phase 2.
- [ ] **Background-job runtime.** Inngest (best DX, vendor lock) vs. Azure Container Apps Jobs (already in our cloud, more ops). Recommend Inngest for Phase 1, optional split out later.
- [ ] **Multi-region.** AU-East primary; consider US/EU for enterprise tenants in Phase 8.
- [ ] **CC migration timing.** Migrate CareerCraft to consume the SDK in Phase 5, or keep CC on direct Azure Function calls until Horus is public-beta-stable? Recommend Phase 5 — forces dogfooding.

---

## 17. Definition of Done (Platform-level)

Horus is "v1" when:

1. A new tenant can sign up, upload a PDF, ask a question, and get an answer with citations — **without me touching anything**.
2. CareerCraft runs end-to-end on `@horus/sdk` with zero direct Azure Function calls.
3. At least one paying tenant on the Pro plan, fully self-serve.
4. White-label tenant on a custom domain with their own branding.
5. SDK published, documented, with a working example app in the docs.
6. 99.5% uptime over the trailing 30 days.

---

## 18. North Star

> Build the layer everyone else gives up on building.

Most teams want hybrid RAG + graph + agentic reasoning + tenancy + observability. Almost none of them ship it. The ones that do take 6–12 months and burn a senior team. We have ~80% of it already. The remaining 20% is repackaging — and the repackaging is the product.

Ship.
