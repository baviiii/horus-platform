# Horus — Runbook

One page: what runs, how to start it, where to look when confused.

> **2026-10-18:** the Azure resources below were deleted when the startup
> credit ran out. Horus now runs on Azure or AWS behind `HORUS_AI_PROVIDER`
> — see [docs/AWS-MIGRATION.md](docs/AWS-MIGRATION.md) for the switch and the
> day-one AWS steps.

## The pieces

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  Horus web  (:3000)         │      │  interview-coach-mcp (:8787) │
│  apps/web — pnpm dev        │◄─────┤  ../interview-coach-mcp      │
│                             │ MCP  │  npm start                   │
│  • /playground   open demo  ├─────►│                              │
│  • /t/careercraft dashboard │      │  26 coaching tools           │
│  • /admin        platform   │      │  brain = Horus /api/infer    │
│  • /api/infer    model gate │      │  research = Wikipedia/HN     │
└──────────┬──────────────────┘      └──────────────────────────────┘
           │
           ▼ Azure (rg-horus-dev)
   Foundry account horusdevai56e136 (eastus2)
     gpt-4o · text-embedding-3-large · gpt-realtime-2.1-mini
     Agent Service (chat agents) · Content Safety
   AI Search horus-dev-srch-a45b90 (knowledge index)
```

The arrow goes BOTH ways on purpose: Horus's agents call the coach's tools
(MCP), and the coach's own generation calls back into Horus `/api/infer`.
One brain, metered per tenant.

## Start everything (2 terminals)

```powershell
# 1 — Horus web
cd horus-platform/apps/web
pnpm dev

# 2 — interview coach (env lives in its .env, nothing to remember)
cd ../interview-coach-mcp
npm start
```

Health checks:

- Horus: http://localhost:3000/playground loads
- Coach: `curl http://127.0.0.1:8787/health` → `{"horus":"http","grounding":"hn","research":"auto"}`
  - `"horus":"http"` = real brain through Horus. `"mock"` = canned demo text.

## Where to look (tracking)

| Question                            | Place                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is everything connected?            | `/t/careercraft/connections` — live green/red per MCP server, tool chips, "Test all"                                                                          |
| Is the agent using tools right now? | chip in any chat: `running interview_coach:…`                                                                                                                 |
| What conversations happened?        | `/t/careercraft/chat` (persisted) + overview page counts                                                                                                      |
| Incident reports?                   | `/t/careercraft/incidents` (dashboard + clocks) · public demo at `/playground/incidents` · design doc `NDIS-VERTICAL.md`                                      |
| The CareerCraft corpus?             | `seed-corpus/manifest.json` (every doc tagged) · refresh: `tsx scripts/fetch-corpus.ts` → `tsx scripts/ingest-corpus.ts --web` → `tsx scripts/build-graph.ts` |
| Knowledge graph?                    | `/t/careercraft/graph` (real Postgres counts) · `graph.*`/`entities.*` tRPC · agent `graph_lookup` tool in workspace chat                                     |
| Platform-wide numbers?              | `/admin` (allowlisted emails only)                                                                                                                            |
| Azure side?                         | ai.azure.com → project horus-dev-project                                                                                                                      |

## Auth in one line

Log in at `/login` (magic link). Emails in `HORUS_ADMIN_EMAILS`
(apps/web/.env.local) auto-become OWNER of any tenant and can open `/admin`.

## Keys & secrets

- Coach → Horus API key: minted with
  `pnpm exec tsx scripts/create-dev-key.ts --tenant=careercraft --force`
  (horus-platform/packages/auth), lives in `../interview-coach-mcp/.env`.
- Workspace API keys: `/t/careercraft/settings` → create (shown once).
- Azure keys: `infrastructure/tofu/envs/dev/print-horus-env.ps1` → paste into
  `apps/web/.env.local`.

## Current truth (2026-07-31)

**CareerCraft GraphRAG live** (see `CAREERCRAFT-GRAPHRAG.md`): corpus refreshed
to the 2026-27 cycle (SA Budget 4 Jun 2026 + federal Overview/DEWR/Education
PBS 12 May 2026 + Australian Jobs 2026), manifest-tagged and ingested with
category/year/tags facets. **26 documents / 1,262 chunks indexed**; Postgres
knowledge graph at **1,859 entities / 1,837 relationships**, both budget years,
171 entities carrying structured dollar amounts. Workspace agent traverses it
via `graph_lookup`; `/t/careercraft/intelligence` serves cited deep-dives;
`/t/careercraft/graph` is a real explorer with per-edge evidence quotes.
Cosmos Gremlin deferred — Postgres is the graph store.

**⚠ Azure AI Search free tier storage is exhausted.** 29 further corpus
documents (DSD industry brochures, education strategies, career-guidance PDFs)
and the 5 web-crawl sources are blocked. Decision pending: reduce vector width
via `AZURE_SEARCH_VECTOR_DIMENSIONS` (needs a destructive index rebuild) or
upgrade the search tier. Details in `CAREERCRAFT-GRAPHRAG.md` §7.

### Previous truth (2026-07-29)

**Working end-to-end:** playground (ingest → RAG chat → citations → realtime
voice), tenant dashboard fully on real data (zero mocks), workspace chat with
persistence, MCP connect/track/execute, coach on the real Horus brain with
live research, Content Safety on ingest+chat, **workspace PDF upload** (tenant
partition + Document rows), and the **NDIS incident vertical** — template
absorption, evidence-cited AI drafting, statutory clocks, review→approve,
de-identified + identified .docx export, photo evidence via gpt-4o vision,
public demo at `/playground/incidents`. See `NDIS-VERTICAL.md`.

**Not built yet (empty states say so honestly):** member invites,
billing/metering writes (usage rows exist, no Stripe), MCP tools on voice
calls, Bing grounding (blocked by sponsored-subscription SKU until PAYG),
AU-region stack (required before a real NDIS pilot — see NDIS-VERTICAL.md).
