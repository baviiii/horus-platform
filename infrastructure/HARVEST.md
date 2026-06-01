# Infrastructure Harvest — Facts Worth Keeping

Everything in `_legacy_careercraft/` is the previous CareerCraft project's Azure infra. It is **frozen for reference only** — being replaced by `infrastructure/tofu/` (greenfield OpenTofu build).

This file captures the load-bearing facts so we don't have to spelunk through ~45 scripts later.

---

## Live Azure resources (still running, costing money)

Resource group: `rg-careercraft-dev` · Region: `australiaeast` · Monthly burn: ~$275–360 AUD

| Resource                                         | SKU                            | Purpose                                                             | Status                                 |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------- | -------------------------------------- |
| Storage Account `cc{env}{hash}`                  | Standard_LRS                   | PDF blobs in `rag-documents` container                              | Live, has data                         |
| Document Intelligence `careercraft-docintel-dev` | S0                             | PDF text/table extraction                                           | Live                                   |
| AI Search `careercraft-search-dev`               | Basic (1 replica, 1 partition) | Vector + semantic search; index `sa-gov-documents` with ~6,368 docs | Live                                   |
| Azure OpenAI `careercraft-openai-dev`            | S0                             | text-embedding-3-large, gpt-4o-mini, gpt-4o                         | Live                                   |
| Functions App `careercraft-functions-dev`        | Consumption Y1                 | RAG + graph + agentic endpoints                                     | Live                                   |
| Neo4j VM                                         | D2s_v3 (Ubuntu 22.04)          | Graph DB                                                            | Live, ports 22/7474/7687 open to world |
| Cosmos DB `careercraft-graph`                    | Gremlin serverless             | Graph DB (parallel to Neo4j)                                        | Live                                   |

**Action needed before P3:** decide whether to (a) keep the CareerCraft RG running until Horus is up and re-index from it, or (b) tear it down once we've captured what we need (saves ~$300/mo).

**Live credentials:** `_legacy_careercraft/.env` (gitignored, never committed). Keep accessible during transition. **Rotate or revoke once Horus is live.**

---

## Reusable design facts (re-implement, don't reuse)

### Embedding model

- **`text-embedding-3-large`** (Azure OpenAI deployment in `australiaeast`)
- 3072 dimensions
- `~$0.10` per 1M tokens

### Chunking strategy

| Param          | Value                  | Note                           |
| -------------- | ---------------------- | ------------------------------ |
| Chunk size     | 800 chars              | Optimal for 3072-dim vectors   |
| Overlap        | 200 chars              | Preserves cross-chunk context  |
| Min chunk      | 50–100 chars           | Filter empty chunks            |
| Splitter (PDF) | Sentence-aware (`.!?`) | Word-based overlap (~30 words) |
| Splitter (web) | Char-based             | Char-based overlap             |

### Search index schema (`sa-gov-documents`)

Reference: `_legacy_careercraft/scripts/create-search-index.ps1`

Vector search: HNSW algorithm (`m=4, efConstruction=400, efSearch=500, cosine`), single profile `vector-profile`. Semantic config `default` prioritizes `title` + `content`.

Field set (32 fields):

- **Identity:** `id` (key), `documentId`, `documentType` (pdf|web), `source`, `url`, `title`
- **Content:** `content` (en.microsoft analyzer), `contentVector` (3072-dim)
- **Position:** `pageNumber`, `chunkIndex`, `chunkType`, `sectionHeading`
- **Quality:** `confidence`, `retrievalWeight` (1.0 text / 1.5 tables), `tagConfidence`
- **Provenance:** `embeddingModel`, `embeddingGeneratedAt`, `indexedAt`
- **Labels:** `category`, `tags[]`, `topics[]`, `occupation`, `sector`, `sectors[]`, `programType`
- **Extras:** `extractedData`, `metadata` (both JSON strings)
- **Charts:** `hasChart`, `chartType`, `chartData`, `chartImageUrl`, `chartConfidence`, `visualDescription`

**Horus must add:** `tenantId` (Edm.String, filterable, retrievable). Every query must `$filter=tenantId eq '...'`.

### Labeling vocabulary

- **9 categories:** `budget, strategy, workforce, education, health, career-guidance, report, policy, government-document`
- **13 sectors:** `health, education, public-sector, construction, technology, agriculture, resources, services, finance, defense, transport, community-services, general`
- **13+ tags:** `south-australia, web-scraped, education, health, employment, budget, training, job-application, migration, regional, disability-inclusion, indigenous, youth`

Rules detail (keywords per category/sector/tag, year extraction logic): `_legacy_careercraft/docs/LABELING-RULES.md`.

**Note:** This vocabulary is CareerCraft-specific. For Horus → multi-tenant, vocabulary should be **per-tenant configurable**, not hard-coded.

### Web scraper targets (CareerCraft tenant only)

Reference: `_legacy_careercraft/web-scraper/enterprise-scraper/scraper.js`

Stack: Node + Playwright (Chromium). ~16 SA gov URLs across 4 strategies:

- **jobs:** jobs.sa.gov.au, iworkfor.sa.gov.au, publicsector.sa.gov.au, sa.gov.au/topics/employment-and-work
- **skills:** migration.sa.gov.au, skills.sa.gov.au, skilledworkers.business.sa.gov.au, business.sa.gov.au
- **news:** premier.sa.gov.au/media-releases, skills.sa.gov.au/news
- **general:** publicsector.sa.gov.au, sahealth.sa.gov.au/careers, education.sa.gov.au

Each target has a `strategy` field driving content-extraction selectors.

---

## Script audit (45 scripts → harvest map)

### Keep & port to Horus workers (~7)

| Legacy script                               | Becomes                                                         |
| ------------------------------------------- | --------------------------------------------------------------- |
| `scripts/create-search-index.ps1`           | Reference for Tofu `azurerm_search_index` schema                |
| `scripts/process-pdfs.ps1`                  | Logic ports to `workers/pdf-upload` (already exists)            |
| `web-scraper/enterprise-scraper/scraper.js` | Becomes a per-tenant scraper worker (CareerCraft tenant config) |
| `scripts/deploy-openai-model.ps1`           | Reference for Tofu OpenAI deployment block                      |
| `scripts/get-azure-secrets.ps1`             | Replaced by Tofu outputs                                        |
| `scripts/deploy-all.ps1`                    | Replaced by `tofu apply`                                        |
| `scripts/populate-graph.ps1`                | Logic ports to `workers/graph-query` if graph stays             |

### Delete (~30+, no harvest value)

- Debug scripts: `check-chart-extraction`, `check-line-60`, `count-all-braces`, `find-missing-brace`, `find-try-catch`, `trace-nesting`, `test-syntax`
- Diagnostic scripts (rebuild in Tofu if needed): `diagnose-index`, `verify-pdf-content`, `verify-index-empty`, `query-table-rows`, `evaluate-rag-quality`, `check-graph-status`, `check-indexer-status`, `compare-labeling`, `test-load`
- Junk: `Untitled-1.txt`
- Markdown disguised as scripts: `EMBEDDING-ERRORS-EXPLAINED.md`, `JSON-SERIALIZATION-FIX-EXPLAINED.md`
- Deploy variants superseded by `tofu apply`: `deploy.ps1`, `deploy-secure.ps1`, `deploy-graph.ps1`, `deploy-neo4j.ps1`, `deploy-azure-functions.ps1`, `deploy-pdf-renderer.ps1`, `reset-index-and-reprocess.ps1`, `scale-openai-for-processing.ps1`, `setup-azure-automation.ps1`
- Migration scripts no longer relevant: `migrate-cosmos-to-neo4j.ps1`, `backfill-relationships.ps1`
- Helper: `prepare-search-doc.py` (Python; replaced by Node worker)

---

## Why CareerCraft's "multi-tenancy" doesn't apply to Horus

The legacy `docs/MULTI-TENANCY.md` proposes **index-per-tenant, container-per-tenant, graph-per-tenant**. This was the right model for CareerCraft (single product, few large tenants) but **wrong for Horus** because:

- Azure Search Basic tier caps at **15 indexes** → 15 tenants max before forced upgrade
- Each tenant index has its own cold-start latency and shard overhead
- Per-tenant deployment dance (the script's `-TenantId` flag) doesn't scale to self-serve signup

**Horus uses shared-index + `tenantId` filter** — see `memory/project_multitenancy.md`. Unlimited tenants, single cold start, one query path, RLS-style discipline enforced at the query layer.

---

## Open decisions before P3

1. **Tear down CareerCraft RG or keep running?** Tearing down saves ~$300/mo but means re-scraping when CareerCraft onboards as Horus tenant 1. Keeping it running lets us re-index the existing ~6,368 docs into the new platform without re-scraping.
2. **Graph DB: Neo4j vs Cosmos Gremlin?** Both are currently live. Cosmos Gremlin is the recommendation (native per-database isolation, serverless, no VM to harden). Decision deadline: end of P2.
3. **CareerCraft data path on onboard:** re-index existing 6,368 docs from old index into new tenant-aware index (one-time migration script, fast) vs re-scrape from scratch (clean, takes a day, costs ~$10–20 in embeddings).
