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

## 9. Still open

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
