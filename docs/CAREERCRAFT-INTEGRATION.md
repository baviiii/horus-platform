# CareerCraft ← Horus: the retrieval integration

> How CareerCraft stopped running its own RAG stack and started reading Horus's
> corpus and knowledge graph. Built 2026-08-13/15.
>
> Companion docs: `CAREERCRAFT-GRAPHRAG.md` (what the corpus and graph are),
> `AZURE-INGESTION-ENGINEERING-LOG.md` (how documents get in), `RUNBOOK.md`.

---

## 0. The state before this work

Horus had everything built and CareerCraft was using none of it.

| Layer                    | Before                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| Generation               | ✅ Already on Horus — `supabase/functions/_shared/ai/horus.ts` → `/api/infer` |
| Retrieval (RAG)          | ❌ Legacy: Azure Function `rag-metadata`, index `sa-gov-documents`            |
| Knowledge graph          | ❌ Legacy: Azure Function `graph-query`, Cosmos Gremlin                       |
| Cross-document reasoning | ❌ Legacy: Azure Function `intersection-reasoning`                            |

The `careers.*` tRPC router, the `@horus/module-careers` package, the SDK and a
read-only API key had all been built — and had **zero callers**. Meanwhile
CareerCoach.tsx was rendering answers from an index of the _old_ corpus, on
infrastructure scheduled for archival.

So the gap was not "build an integration". It was "connect two finished halves".

---

## 1. The one decision that shaped everything: where the key lives

CareerCraft's frontend is Vite. **Vite inlines every `VITE_*` variable into the
client bundle at build time.** Anything prefixed that way is readable by anyone
who opens devtools — it is not configuration, it is publication.

The legacy code shipped `VITE_AZURE_FUNCTION_KEY` to the browser, which was
already a leak. Repeating that with a Horus tenant key would hand out the entire
corpus and the ability to spend our tokens against our Azure bill.

So the browser never sees the Horus key. The chain is:

```
browser  ──user's Supabase JWT──▶  horus-rag edge function  ──HORUS_API_KEY──▶  Horus
                                   (Deno, server-side)
```

This is the same shape as the existing `infer` function, deliberately — one
pattern for reaching Horus, not two.

`VITE_HORUS_RAG` **is** a `VITE_` variable, and that is correct: it is a
kill-switch flag, not a secret. Public knowledge of "the Horus path is on" costs
nothing.

---

## 2. Why the adapter sits on the server

Horus returns its own shapes. The React app expects the shapes the old Azure
Functions returned. Something has to translate.

Putting the translation in the edge function means `useRAGMetadata`,
`useEnterpriseRAG`, `useAgenticRAG`, `CareerCoach.tsx`, `ChatEnhancements.tsx`
and every component below them keep working **untouched**. One file changes
shape; a dozen call sites do not.

The alternative — adapting in the frontend — smears the mapping across every
caller and makes the next backend change a rewrite. It also means shipping the
knowledge of Horus's internals to the browser.

```ts
// horus-rag/index.ts
Horus  { id, documentId, title, excerpt, score, pageNumber?, sourceUrl? }
   ↓
App    { id, documentId, title, content, score, pageNumber?, url? }
```

Two non-obvious transforms happen there:

**Excerpt cleaning.** Content Understanding emits markdown, which is _why_ the
chunks are good — but it leaves layout furniture in the text:
`<!-- PageNumber: 15 -->`, `![](figures/17.1)`. Useful to the extractor, noise
on a citation card. Stripped before it reaches a reader.

**Score rescaling.** Horus scores are hybrid RRF values in the ~0.01–0.05 range.
The old UI normalised from BM25's 0–50 range. Passing RRF scores through
unchanged renders every source as "1% relevant". `relevancePercent()` rescales
against the RRF ceiling instead.

---

## 3. Speaking tRPC without the SDK

`@horus/sdk` is a tRPC client whose type safety comes from importing `AppRouter`
from this repo. CareerCraft is a separate repository, and the edge functions run
on Deno. That type is not reachable there.

tRPC's HTTP contract is stable and small, so `_shared/ai/horus-knowledge.ts`
speaks it directly — no dependency, no build step:

```
queries    → GET  {base}/api/trpc/{path}?input={"json":{...}}
mutations  → POST {base}/api/trpc/{path}   body: {"json":{...}}
response   → {"result":{"data":{"json": <value> }}}
errors     → {"error":{"json":{"message":…,"data":{"code":…,"httpStatus":…}}}}
```

The `json` wrapper is **superjson**, which Horus enables so `Date`/`BigInt`/`Map`
survive the round trip. Everything read back here is plain JSON, so unwrapping
the envelope is the whole job.

One deliberate piece of error handling: `careers.*` throws `NOT_FOUND` when a
name does not resolve to a graph entity. For a career question that is an
ordinary outcome — the user asked about a job the corpus never mentions — so it
becomes a typed `HorusNotFound` and the caller renders "nothing found", rather
than an exception that reads like an outage.

---

## 4. The one file that made this small

`useRAGMetadata.ts` has a single module-level function, `executeSemanticSearch`,
that **every** retrieval path in the app funnels through — `useEnterpriseRAG`,
`useAgenticRAG`, `useIntelligencePrompts`, `TryUs.tsx`. It already had a
two-tier primary/fallback structure.

Adding Horus as a new top tier was therefore one edit, not a rewrite:

```
PRIMARY   Horus            (horus-rag edge function)
LEGACY 1  Azure Functions  (rag-metadata → sa-gov-documents)
LEGACY 2  Supabase         (rag-query)
```

Horus failures log loudly and **fall through** rather than surfacing. While two
stacks are deployed, an outage on the new one must not take the product down.
Once Horus is proven in production, both legacy tiers and every `VITE_AZURE_*`
variable should be deleted outright — they read an index that will not exist.

The graph operations in `useAgenticRAG` got the same treatment:

| Legacy call                        | Horus replacement                                     |
| ---------------------------------- | ----------------------------------------------------- |
| `graph-query` action:`search`      | `careers.occupation` → falls back to `careers.sector` |
| `graph-query` action:`traverse`    | `graph.query` (bounded BFS neighbourhood)             |
| `graph-query` action:`get_impacts` | `graph.query` — an "impact" _is_ an edge              |

---

## 5. Bugs this work uncovered

All four were pre-existing and none were visible from reading the code. They
were found by running the integration against live data.

### 5.1 `ensureKnowledgeIndex` was 500ing every agent chat

**Symptom:** `POST /api/sdk/chat` → 500.

```
RestError: Existing field 'id' cannot be changed.  [CannotChangeExistingField]
```

**Cause:** when the Content Understanding pipeline rebuilt `horus-knowledge`, it
created the index with `id` carrying `analyzer: 'keyword'` — required so index
projections' generated keys survive tokenisation. `buildIndexDefinition()` in
`store.ts` still declared `id` without it. AI Search treats existing field
attributes as immutable, so `createOrUpdateIndex` was rejected. It is awaited
with no catch, so a rejected _schema upgrade_ became a 500 on the user's request.

**Blast radius:** `/api/sdk/chat` **and** `/api/agent/chat` — i.e. the Horus
dashboard's own workspace chat — broken since the pipeline rebuild on 2026-08-06.

**Fix:** the word "ensure" was doing the wrong job. This module no longer owns
every index it reads: the corpus index belongs to
`scripts/setup-search-pipeline.ts`. So `ensureKnowledgeIndex` now guarantees
_the index exists and is queryable_, not _the index matches my definition_. If
the update is rejected but the index exists, log and continue. Only a genuine
"it isn't there" is fatal.

**Lesson:** when ownership of a resource moves, every function that assumed
ownership becomes a latent bug. The comment on that function literally read
"the app owns its index schema" — it had stopped being true.

### 5.2 Graph traversal returned no evidence

`graph.query` built its edges as `{id, fromEntityId, toEntityId, type,
confidence}` and dropped `metadata.evidence` on the floor — even though
persistence stores up to three verbatim quotes per edge, and the whole selling
point of the graph is that a relationship claim is checkable.

Fixed at the source (`GraphEdge.evidence`, populated in `traverse()`), so the
Horus graph explorer benefits too, not just CareerCraft.

Result: `Findon Technical College —supports→ Defence` now arrives with
_"Findon Technical College will help South Australian school students develop
the knowledge and skills needed for jobs in advanced manufacturing and
engineering, including in the defence…"_

### 5.3 Traversal returned a subgraph that wasn't self-consistent

Of 400 edges returned for `graph.query("Defence", depth 2)`, **217 pointed at
entities absent from `nodes`**.

The BFS admits nodes only while `nodeIds.size < MAX_NODES`, but keeps recording
edges after that cap is hit. So edges accumulated endpoints that were never
added to the node set. Any consumer resolving an endpoint id against `nodes`
found nothing and rendered a dangling edge.

Fixed by filtering, after the walk, to edges whose _both_ endpoints survived.
400 → 183 edges, all resolvable.

### 5.4 `maxSources: 10` was sized for a corpus a quarter the size

Measured, on "How many workers does the SA defence sector employ?":

| maxSources | Result                                                      |
| ---------- | ----------------------------------------------------------- |
| 5          | _"The passages do not provide information…"_ — confidence 0 |
| 10         | same refusal                                                |
| **12**     | **"more than 14,000 workers"** — confidence 1.0             |
| 20         | same, plus the 10,000-job pipeline figure, cited `[13]`     |

The retrieved set was concentrating on documents matching the question
_topically_ (the DSD defence brochures) while the document stating the fact (SA
Jobs and Skills Outlook) fell outside the window. The default was chosen when
the corpus held ~1,300 chunks; it now holds 4,800.

Default raised to 16. Note what did **not** happen: the model never invented a
number. It refused, correctly, and said so. The failure was retrieval, and the
grounding held.

---

## 6. Verification

`scripts/` has no home for a cross-repo test, so verification ran the _real_
`horus-knowledge.ts` module against a live Horus under a minimal Deno shim —
the part worth testing being the wire format, envelope unwrapping, error
mapping, and whether declared types match reality. They did not, twice:
`SectorProfile` has `funding`, not `funders`/`skills`; graph edges use
`fromEntityId`/`toEntityId`, not `from`/`to`. Both were caught here rather than
in production.

Final state — all checks passing:

```
1) rag.query        → 5 sources, all with pageNumber + sourceUrl, artefacts stripped
2) careers.occupation("nurse")  → "Registered Nurse", 11 skills w/ evidence, 16 docs, coverage=strong
3) careers.sector("defence")    → 13 occupations, funding[] present
4) graph.query("Defence", d2)   → 150 nodes / 183 edges, 183/183 with evidence, 0 unresolved
5) careers.search               → scoped to 5 careers categories
6) NOT_FOUND                    → typed HorusNotFound, not a 500
7) rag.metadata                 → 84 docs / 4,800 chunks / 7,523 entities / 10,422 relationships
8) invalid key                  → rejected
```

Both repositories typecheck clean (`pnpm typecheck` 16/16; `tsc --noEmit`).

---

## 7. Deploying it

```bash
# 1 — Horus: mint a read-only consumer key (plaintext shown once)
pnpm exec tsx scripts/mint-consumer-key.ts --tenant=careercraft \
  --name="CareerCraft web" \
  --scopes=rag:read,graph:read,entities:read,documents:read

# 2 — CareerCraft: set secrets (HORUS_BASE_URL is the ORIGIN, no path)
#     .env → HORUS_BASE_URL=https://<horus>.vercel.app
#            HORUS_API_KEY=horus_sk_live_…
./set-supabase-secrets.sh        # or .ps1 — both validate the URL shape

# 3 — deploy the function
supabase functions deploy horus-rag

# 4 — frontend flag (optional; on by default)
#     VITE_HORUS_RAG=off  reverts to the legacy path without a redeploy of Horus
```

**Rollback:** set `VITE_HORUS_RAG=off` and rebuild the frontend. The legacy
tiers are still wired and will serve.

---

## 8. Legacy removal — wave 1 (done 2026-08-15)

Principle applied: **delete only what Horus actually replaces.** An inventory
first, because the obvious guess was wrong twice.

**Removed:**

| Thing                                                             | Why it was safe                                     |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `supabase/functions/rag-query`                                    | zero callers                                        |
| `supabase/functions/rag-tag-documents`                            | zero callers                                        |
| `supabase/functions/rag-metadata`                                 | last callers migrated, then orphaned                |
| `packages/horus-sdk`                                              | **zero imports** — and see the name collision below |
| Legacy fallback tiers in `executeSemanticSearch`                  | Horus is the only retrieval engine now              |
| `VITE_AZURE_*`, `AZURE_DOCUMENT_INTELLIGENCE_*`, `AZURE_SEARCH_*` | nothing reads them                                  |

**Migrated to Horus:** `CrossTabConnections`, `SAFundingIntelligence`,
`SAMarketIntelligence` (via a `horusSemanticSearch` compatibility wrapper that
preserves the old `{success,data,error}` envelope, so downstream parsing was
untouched); `ExploreSA` categories + search; `useRAGMetadata`'s `getStats` /
`getCategories` / `getDocuments` / `searchDocuments` / `getBulk`.

**The `@horus/sdk` name collision.** Two different packages carried that exact
name: `horus-platform/packages/sdk` (the tRPC client, the real product) and
`careercraft-pages/packages/horus-sdk` (a wrapper around the _legacy_ Azure
Functions). Same name, opposite backends, different repos. The CareerCraft one
had zero imports and is gone. This is worth recording because it made the
system genuinely hard to reason about — "is there an SDK?" had two answers.

### Deliberately kept — no Horus equivalent exists

Deleting these would break five feature pages, so they stay until replaced:

| Legacy action            | Powers                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `simulate_scenario`      | `ScenarioModeler.tsx`                                                                                                                 |
| `get_alerts`             | `ProactiveImpactAlerts.tsx`                                                                                                           |
| `forecast_impacts`       | `MarketTrends.tsx`                                                                                                                    |
| `aggregate_impacts`      | `IntelligenceOverview.tsx`, `CareerExplorer.tsx`                                                                                      |
| `fetch-tables`           | `DataTableVisualizer.tsx` — Content Understanding embeds tables _inside_ chunk markdown, so there is no separate table store to query |
| `agentic-planner`        | `useAgenticRAG` planning                                                                                                              |
| `intersection-reasoning` | contradictions / themes / gaps                                                                                                        |

So `azure-rag-proxy`, `azure-graph-proxy`, `azure-pdf-proxy`,
`lib/azureFunctions.ts` and `packages/horus-services` all remain.

**The fallbacks for the last two are empty**, which is why they were not
deleted: `createFallbackPlan` returns a single-step plan (collapsing agentic
mode into plain RAG) and `performBasicAnalysis` returns
`contradictions: [], gaps: [], themes: []`. Removing the Azure Functions
without building replacements would silently blank those UI surfaces.

## 9. The budget router — wiring PolicyVisualizer (2026-09-16)

`PolicyVisualizer.tsx` was the last page in CareerCraft with no backend at all.
Its charts read four module-level arrays typed into the file: an invented
budget split, an invented $450M "SA Workforce Strategy 2024" allocation, an
invented 12,500 jobs, hardcoded training providers on every card, and a
"Last updated: December 2024" line under it. It rendered as though it were
reporting on the corpus. It was not connected to anything.

The corpus, meanwhile, already held the material: 19 `budget` documents and 3
`budget-federal`, both SA budget years plus the Commonwealth papers, and a
graph carrying **2,666 entities with `amount_aud`** and **3,455 `funds` edges**
with verbatim evidence. The gap was again "connect two finished halves".

### 9.1 The decision that shaped the whole design: no sums

The obvious endpoint is "total budget per year", and it cannot be built
honestly from this data. `amount_aud` is not a homogeneous series — the same
column holds:

| What                | Example                                | Magnitude |
| ------------------- | -------------------------------------- | --------- |
| discrete measure    | Fee-Free TAFE                          | millions  |
| portfolio roll-up   | Total Consolidated Account payments    | $27.3bn   |
| balance-sheet stock | General Government Sector Total Assets | $127bn    |

…across two budget years and two jurisdictions, with the same measure often
extracted more than once (commonly as both a `program` and a `funding` entity
with identical amounts). Summing those yields a large, confident number that
corresponds to nothing in any document — and, crucially, **nothing downstream
could flag it**, exactly like the hardcoded arrays it would be replacing.

So `budget.*` exposes no totals and offers no endpoint that would produce one.
Every figure returned is one extracted value with its document and its quote.
Aggregation is limited to **counting** — "this funder appears on 115 measures"
is checkable against the graph; "this funder spent $X" is not. `metric`
entities are excluded from allocation reads: net worth is a stock, and ranking
it beside programme spending invites the comparison that isn't valid.

### 9.2 `evidenceStatesAmount` — the bug this surfaced

The evidence quote hangs off the `funds` **edge**. It proves "X funds Y" — not
necessarily the amount, which the extractor may have read from a table cell
elsewhere in the chunk. Live example:

```
AUKUS   amount_aud = 30,000,000,000   period 2026-27
quote:  "The 2026-27 Budget reflects that funding is already supporting large
         scale economic recovery and growth projects across regional areas,
         including … Northern Water, and AUKUS"
```

The quote states no figure at all. Rendering the amount beside it implies a
corroboration that does not exist — a subtler version of the original sin.

So the router computes whether the quote actually contains the amount and ships
the flag; the UI labels the two cases differently ("Source sentence — states
this figure" vs "Relationship evidence — does not state the figure"). Matching
accepts ×1000 and ×1e6 scaling because budget tables are denominated in $000
and $m while the extractor normalises to whole dollars — "15 400 000" in a
table backs an amount of 15.4bn. On the current graph (after the §9.6 fixes),
of 60 allocations for 2026-27, 51 carry a quote and **42 of those state the
figure itself**.

### 9.3 Tenancy note

`budget.*` uses raw SQL for the JSONB numeric sorting Prisma cannot express in
`orderBy`. Raw SQL does **not** pass through `createTenantScopedClient` — that
extension only rewrites `where` on model operations — so every query filters
`"tenantId"` explicitly and parameterised, on **every** table, including those
reached through a join (`document_entities`, `documents`, the funder and
measure entities): the schema's single-column foreign keys do not stop a join
row pointing across tenants. Verified: the other two tenants read zero rows.

### 9.4 Shape

| Procedure            | Returns                                                     | Powers               |
| -------------------- | ----------------------------------------------------------- | -------------------- |
| `budget.periods`     | periods with measure counts, best-covered year first        | the period selector  |
| `budget.allocations` | ranked measures + evidence + funders + source documents     | the ranked bar chart |
| `budget.funders`     | funders by distinct measure count, plus one largest measure | the funders panel    |

`BudgetAllocation.aliases` (added 2026-10-02) lists the other names a merged
measure was extracted under. Optional for the client — render it as "also
called …" if useful; ignoring it loses nothing.

Edge function ops `budget-periods` / `budget-allocations` / `budget-funders`
pass straight through — unlike the retrieval ops there is no legacy shape to
adapt to, and reshaping could only drop provenance. Frontend:
`useBudgetIntelligence` → `lib/horusKnowledge.ts`.

**The existing CareerCraft keys already carry `graph:read`** — checked against
the database, no re-mint needed.

Verification: `pnpm exec tsx scripts/verify-budget-router.ts` — exercises the
real router through the real caller against live data (periods, ranking,
de-duplication, citation coverage, jurisdiction labelling, funders, tenant
isolation, empty-period handling) plus the corroboration cases above.

### 9.5 What was deleted

`budgetData`, `investmentTimeline`, `policyConnections`, `careerPathways`, the
hardcoded TAFE SA / UniSA / Adelaide Uni provider badges, the hardcoded
"2024-2028 (4 year program)" timeline, the non-functional "View Policy
Document" / "AI Summary" / "View all sources" buttons, and the false "Last
updated: December 2024" attribution. The Sankey-style `careerPathways` flow has
no grounded equivalent and was removed rather than re-sourced.

### 9.6 Fixes after the pre-publish review (2026-10-02)

A review, checked against the live top 25 for 2026-27, found the chart's
visible problems were not the ones it ranked first:

- **One measure, three bars.** The $5.9bn medicines measure appeared as "PBS
  Medicines Program", "Life-Saving Medicines Cost Reduction" and "…Program"; the
  $2.9bn fuel-excise package likewise. Exact-name de-duplication could not see
  it. Now merged when amount, period and a source document match **and** there
  is positive evidence of sameness: an identical quote, one name's distinctive
  words contained in the other's, or a figure-stating quote naming the other.
  Word overlap alone was tried and rejected — it merged two different $500m SA
  funds, Apartment Fast-Track and Housing Fast-Track. Merging keeps evidence,
  funders and documents from every row; the old rule dropped the funding row's
  quote when keeping the program row's label.
- **Totals and revenue in a spending chart.** "Total Consolidated Account
  payments" ($27.3bn — essentially the whole SA budget) ranked #3; "Total Sales
  of Goods and Services Revenue" #16. A name rule now excludes totals, revenue,
  receipts, appropriations, financing and short accounting-statement lines
  (calibrated on the 183 candidates among 2,084 figures).
- **"States this figure" was wrong ~1–2 times per 100**, from number fragments
  ("2026-27" read as $27m, "$8,670,233,000" as $670m) and loose tolerance. The
  parser now strips dates and financial years, reads grouped numbers whole,
  reads space-grouped table rows as runs of columns, and scales only
  table-cell-shaped numbers. It also catches "$1.2bn" stored as $1.2m. Evidence
  is now chosen from every quote on every funds edge, deterministically.
- Smaller: periods count distinct measures and open on the best-covered single
  year; funders join by entity id; an index on `document_entities("entityId")`
  (~20% faster allocations).

**Still open**, and why:

- The totals rule is a name rule. It misses portfolio lines without "Total" in
  the name ("Health Services", $5.6bn) and bundles ("Strengthening Australia's
  Fuel Resilience Package", $14.8bn, whose components are also listed); "package"
  is deliberately not in the rule because most packages are real initiatives.
  Fix: the extractor tags each figure as measure / total / revenue / balance.
- A figure the extractor attached to a site rather than its fund can show twice
  ("Warradale Barracks Housing Development" carries the Housing Fast-Track
  Fund's $500m). The merge leaves it separate rather than risk hiding a measure.
- The flag checks digits, not units: an unconverted $000 cell still "matches".
- One entity per (type, name) with attributes merged key-by-key means amount,
  period and source can come from different extractions — e.g. AUKUS at $30bn
  labelled "state". Fix: store each extraction's amount + period + document as
  one record.

## 10. `/api/embed` — similarity ranking for jobs and news (2026-09-27)

CareerCraft ranks the jobs and articles it already fetches by how close each is
to the user's profile. The edge function (`job-news`, `job-search`) sends the
profile text plus every item text in one call, gets vectors back, and takes
the cosine itself. Nothing is stored on either side, so there is nothing to go
stale when a profile changes and nothing to migrate if the model does.

```
POST /api/embed                       Horus API key, scope intelligence:infer
  in:  { input: string[]              1–128 items, each ≤ 8,000 chars, ≤ 200,000 total
         model?: 'small'              the only model served (text-embedding-3-small)
         dimensions?: number }        64 … 1536
                                      inputs × dimensions ≤ 150,000, else 400
  out: { vectors: number[][]          one per input, in input order
         count, model, dimensions, tokens }
```

- **Own deployment, small only.** It runs on a dedicated deployment (350K
  TPM). `large` is deliberately not offered: the only large deployment is the
  knowledge index's (50K TPM), and outside traffic on it would throttle
  Horus's own search for every tenant. If small ever proves too weak, add a
  dedicated large deployment. Idle deployments cost nothing; Standard bills
  per token.
- **Response-size cap.** Vercel refuses responses over 4.5 MB. The route
  rejects `inputs × dimensions > 150,000` _before_ calling Azure, so an
  oversized request is never billed. 100 inputs at 512 dimensions is 51,200.
- **Inputs over 2,000 chars are truncated, not rejected.** That's a job title
  plus the opening of its description. The rest of a JSearch advert is
  benefits and boilerplate that multiplies the cost without changing the
  ranking.
- **Same key as `/api/infer`.** It reuses `intelligence:infer`, so the key
  `horusInfer()` already uses works without a re-mint.
- **Metered.** One `UsageRecord` per call (`EMBEDDINGS`, tokens, `apiKeyId`).
  A metering failure is logged and does not fail the request.
- **Fails fast.** 8 s timeout, no retries. On a 429 the OpenAI SDK would
  otherwise sleep for Azure's Retry-After (up to 59 s) before retrying. The
  caller falls back to ranking without similarity, so a quick 502 beats a
  slow success.
- **Keys of deactivated tenants are refused** (`validateApiKey` filters on
  `tenant.isActive`), matching what the tRPC resolver already enforced.
- **Ask for `dimensions: 512`.** One profile plus 50 jobs at native width is
  ~1.5 MB of JSON on small (3 MB on large); at 512 it is ~470 KB and returns
  in roughly half the time. Ranking 50 items needs nothing wider.
- **Vectors from different models are not comparable.** Embed the profile and
  its items in the same call, which the design already does.

**Ranking check (`scripts/verify-embed.ts --compare`).** Five cases, each
passing only if every related (and adjacent) item outscores every unrelated
one: nurse vs nursing jobs, Australian shorthand both ways (AIN/PCA adverts
against a spelled-out aged-care profile; sparky/FIFO against an electrician),
health-sector roles adjacent to a nurse, and news headlines. Baseline on
large, 2026-09-29: **5/5**, with margins of 0.185 / 0.254 / 0.183 / **0.078** /
0.149. The adjacent-roles case is the tight one and the one to watch on small.
`--compare` prints both models side by side.

## 11. Still open

1. **Wave 2 — the agentic collapse.** The Horus agent already does multi-step
   tool use server-side (it reformulated "how many workers…" into a
   `search_knowledge` call on its own). That means `useAgenticRAG`'s ~1,000
   lines of browser-side planning, step execution and context assembly is
   re-implementing what `streamHorusChat` gives in one call. Replacing it
   retires `agentic-planner` and most of the hook.
2. **`intersection-reasoning` has no Horus equivalent yet.** `useAgenticRAG`
   still calls the legacy endpoint for contradiction/theme analysis.
   `intelligence.contradictions` is the intended replacement and is still a
   stub — but the graph now holds 46 `contradicts` edges and both budget years,
   so the hard part is done.
3. **`agentic-planner` still runs on the legacy Function.** The client-side
   fallback planner (`createFallbackPlan`) covers an outage. Replacing it means
   either exposing planning from Horus or moving it into the edge function.
4. **Pathway quality is uneven.** `careers.pathway("Certificate III",
"Registered Nurse")` returns a real chain, but routed through
   `Construction → Victoria` — the shortest path is not always the meaningful
   one. Worth weighting edges by type before this is user-facing.
5. **`buildIndexDefinition` still describes a schema that is not deployed**
   (`year`/`tags` as Int32/Collection, no `pageNumber`/`region`/`parentId`).
   It is now inert for the corpus index thanks to §5.1, but it is a trap for
   whoever reads it next.
