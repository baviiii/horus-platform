# CareerCraft — Corpus, RAG & Knowledge Graph

> How CareerCraft's intelligence layer is built: a tagged document corpus in
> Azure AI Search, a Postgres knowledge graph extracted from it, and the
> GraphRAG surfaces on top. Built 2026-07-29/30.

**The shape of it:** documents are ingested once, tagged by area/year, chunked
and embedded into Azure AI Search. A second pass reads those chunks back and
extracts a typed knowledge graph — organisations, programs, sectors,
occupations, skills, funding — with an evidence quote on every edge. Retrieval
answers _what the documents say_; the graph answers _how things connect_. The
briefing endpoint uses both.

---

## 1. Decisions

**Postgres is the graph store, not Cosmos Gremlin.** The Prisma schema already
had `Entity` / `Relationship` / `DocumentEntity` with tenant RLS, and the old
Gremlin worker belonged to the CareerCraft infra being archived. At this scale
(~1,200 entities) recursive traversal in Postgres is instant, it removes an
always-on Azure resource from the Tofu greenfield, and it keeps the graph
inside the same RLS boundary as everything else. Cosmos is deferred until a
tenant's graph genuinely outgrows relational reach — not before.

**SA-deep, national-wide.** The corpus goes deep on South Australian budget and
skills documents, and covers the rest of Australia through national datasets
(Australian Jobs, JSA projections, federal portfolio budget statements) rather
than chasing eight states' budget papers. Another state becomes a tenant
onboarding task, not a platform rebuild.

**Federal scope is trimmed.** Budget Overview + the Employment/Workplace
Relations and Education portfolio budget statements — the parts that carry
skills and education money. Not the full federal paper set.

**Both budget years stay.** 2025-26 and 2026-27 are both indexed and both in
the graph. "What changed year over year" is the question that makes this look
like intelligence rather than search.

---

## 2. The corpus

`seed-corpus/manifest.json` is the single source of truth. Every document
carries `category`, `region`, `year`, `tags`, and a `graph` flag (whether the
extractor runs over it). Scripts read this file; nothing is hardcoded.

**Refreshed to the 2026-27 cycle** (verified live, downloaded 2026-07-29):

| Source                                        | Released    | What                                                                            |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| SA State Budget 2026-27                       | 4 Jun 2026  | BP1 Overview, BP2 Speech, BP3 Statement, BP4 Agency Statements ×4, BP5 Measures |
| Federal Budget 2026-27                        | 12 May 2026 | Budget Overview                                                                 |
| DEWR Portfolio Budget Statements 2026-27      | 12 May 2026 | employment + skills programs                                                    |
| Education Portfolio Budget Statements 2026-27 | 12 May 2026 | education programs                                                              |
| Australian Jobs 2026 (JSA)                    | ~Jun 2026   | occupations, industries, pathways                                               |

**Watch list** (in the manifest, with expected dates): Jobs & Skills Report 2026
(~Nov 2026), SA Mid-Year Budget Review 2026-27 (~Dec 2026), SASC Annual Report
2025-26, JSA Work Plan 2026-27, DSD Jobs & Skills Outlook refresh.

### Scripts

```bash
pnpm exec tsx scripts/fetch-corpus.ts      # download manifest docs that have a url
pnpm exec tsx scripts/ingest-corpus.ts     # → tenant partition + Document rows  (--web for crawls)
pnpm exec tsx scripts/build-graph.ts       # chunks → entities + edges → Postgres
pnpm exec tsx scripts/dedupe-graph.ts      # merge duplicate entities (--dry to preview)
```

All four are idempotent and support `--only <id-substring>`, so a single
document can be re-run without touching the rest.

---

## 3. Retrieval layer

Chunks land in Azure AI Search partitioned by `tenantId` + session
(`workspace` for real tenants). The index gained three filterable facets —
`category`, `year`, `tags` — added as new fields so existing documents keep
working. `searchKnowledge` takes an optional `filters` object, which is what
lets a brief be scoped to "budget documents, 2026 only".

One implementation note worth remembering: **AI Search field attributes are
immutable once deployed.** Trying to make the existing `chunkIx` filterable
failed the whole index update; `fetchSourceChunks` pages with `skip`/`top` over
a sort instead. New fields can be added freely — existing attributes cannot be
changed without rebuilding the index.

---

## 4. The graph

**Extraction** (`packages/core/src/entities/extract.ts`): chunks are batched
(5 at a time) into a structured-output call that proposes entities and
relationships against fixed type enums. Everything is validated before it can
reach the database — an invented type is dropped, and an edge whose endpoints
aren't in the same batch's entity list is dropped. Every edge carries a
verbatim evidence quote. Dollar amounts land as
`attributes: { amount_aud, period }` on the funded entity.

**Persistence** (`persist.ts`): upserts converge. The same entity seen across
documents becomes one node with merged aliases and counted mentions; the same
edge seen twice keeps its best confidence and up to three evidence samples.

**Entity resolution** (`canonicalName` + `scripts/dedupe-graph.ts`): the model
writes the same thing several ways across a corpus. Canonicalisation strips
leading "the", drops a trailing "sector"/"industry" on sector entities, and
title-cases names the model wrote entirely lowercase (a conservative signal
that it's a common-noun phrase, so "TAFE SA" and "AUKUS" keep their form). The
dedupe script applies current rules to stored rows and merges collapses —
repointing edges, merging document links, keeping the old surface form as an
alias.

### Live state (2026-07-31)

**1,859 entities / 1,837 relationships** across 17 documents — both budget
years (2025-26 and 2026-27), the federal set, and the jobs/skills reports.
The second extraction run produced **zero duplicates**, confirming the
canonicalisation rules now catch collisions at write time rather than needing
a cleanup pass.

Because both years are in, the graph answers year-over-year money questions
directly. `graph_lookup("Health")` returns, with sources:

> `Capital Expenditure 2025-26 → funds → Health` — _"Health received $810 million in capital expenditure for 2025-26."_
> `SA State Budget 2025-26 → targets → Health` — _"Health capital expenditure: 729 million AUD for 2025-26."_

**171 entities carry a structured dollar amount.** Top of the list, straight
from the 2026-27 papers:

| Entity                                             | Amount  | Period             |
| -------------------------------------------------- | ------- | ------------------ |
| National Health Reform Agreement Addendum          | $24.4bn | 2026–2031          |
| North-South Corridor — River Torrens to Darlington | $11.2bn | 2025-26 to 2029-30 |
| Thriving Kids Program                              | $4.0bn  | 2026-31            |
| GST Revenue Grants                                 | $3.0bn  | 2026-27            |
| New Women's and Children's Hospital                | $2.9bn  | 2025-26 to 2029-30 |
| Sovereign Steel Package                            | $2.4bn  | —                  |

Money-flow edges read like this, with their evidence:

> `Government of South Australia → funds → Murray Bridge MetroTicket Fares Expansion`
> _"$7.9 million over four years to expand the metroCARD zone to Murray Bridge."_

---

## 5. Surfaces

**`graph.*` / `entities.*` tRPC routers** — real implementations on Prisma.
`graph.query` resolves a name (exact → alias → contains) then walks a BFS
neighbourhood, capped at depth 3 / 150 nodes / 400 edges so a hub entity can't
blow up a request. `graph.stats` powers the dashboard.

**`graph_lookup` agent tool** — the workspace agent can now traverse. Asked how
things connect, it looks up the entity, gets grouped in/out edges with evidence
quotes plus the documents that mention it (registered as citations), and
answers from structure rather than guessing from passages.

**`intelligence.brief`** — the deep-dive endpoint. Subject + focus
(overview / funding / skills / outlook), optional category and year filters.
Anchors on a graph entity, retrieves 12 filtered passages, and returns a
structured brief: overview, key numbers, programs & funding, skills &
occupations, outlook, and **gaps** — what the corpus does not answer. Every
claim cites a passage. Token usage is metered to `UsageRecord`.

**`/t/[tenant]/intelligence`** — the briefing UI. Focus chips, area/year
filters, suggested subjects pulled live from the graph's best-connected
entities, key numbers as stat tiles, citation superscripts, and a sources list.

**`/t/[tenant]/graph`** — a real explorer. Type distribution, searchable and
type-filtered entity list, and an entity detail pane showing in/out edges
_with the sentence each was extracted from_, plus the documents it appears in.
A graph you can't audit is a graph you can't sell.

---

## 6. Verified live (2026-07-30)

Full stack exercised through the production tRPC path with a real tenant
context — not mocks:

- `graph.stats` → 1,859 entities / 1,837 relationships
- `graph.query("Health", depth 2)` → 58 nodes / 64 edges
- `graph_lookup("Health")` → incoming funding edges from both budget years, each with its source sentence, plus three document citations
- `intelligence.brief("defence", focus=funding)` → 13s, anchored on a graph entity, produced $53bn / $13.5m / $5bn as cited key numbers across 12 passages, and listed five honest gaps
- `pnpm typecheck` green across all 14 workspace tasks; `pnpm --filter @horus/web build` green with both new routes

---

## 7. Known limits

1. **Azure AI Search free tier storage is exhausted.** 26 documents (1,262
   chunks) are indexed — the complete budget corpus, both years, plus the
   federal set and the jobs/skills reports. **29 documents were blocked**
   mid-run: the DSD industry brochures (defence, space, hydrogen, quantum,
   screen, tourism…), the education strategies, and the career-guidance PDFs.
   This is the binding constraint on corpus completeness, and it needs a
   decision — see options below.
2. **Web sources not yet crawled.** The five `webSources` entries (Skills SA,
   Migration SA, I Work for SA, sa.gov.au employment, DEWR skills) are wired
   and ready but blocked behind the same storage ceiling.
3. **`rag.*` router still stubbed.** The retrieval engine is live everywhere
   that matters (agent chat, briefs, playground) but the thin `rag.query/chat`
   procedures still throw `NOT_IMPLEMENTED`. Cosmetic, but it's a lie in the
   API surface — either wire them to the same engine or delete them.
4. **Extraction is capped** at 40 batches per document (`--max-batches`), so
   very long agency statements are partially covered. Fine for now; raise it
   when storage allows and cost is justified.
5. **`intelligence.contradictions`** (cross-document contradiction detection)
   is still a stub — the highest-value remaining item, since the graph now has
   `contradicts` as a real edge type and both budget years indexed.

---

## 8. Enterprise ingest path (built 2026-08-01, not yet applied)

The hand-rolled `extractPdf` → chunk → embed path flattens tables: a budget row
came out of the graph as `"…Planning(e) Jun 2027 2 148 17 000"` — three
columns mashed into one string. Budget papers keep their money in tables, so
that is the accuracy ceiling. The replacement hands extraction to Azure.

**Content Understanding, not Document Layout.** Microsoft's own comparison:
Document Layout emits tables and figures as _plain text_ ("can result in
information loss"); Content Understanding emits **Markdown**, treats a table
spanning pages as **one unit**, and costs less. Its `2026-05-01-preview` adds
**semantic chunking** — layout-aware, respects paragraph boundaries, handles
tables that cross chunk edges — which is precisely the failure above.

**Everything downstream is untouched.** The indexer writes chunks into our
existing schema via index projections, so `searchKnowledge`, `build-graph.ts`,
`graph_lookup` and `intelligence.brief` keep working — they just get better
chunks. The graph layer already sat on the right side of that boundary.

### Australian residency

Content Understanding runs in only a handful of regions and `australiaeast` is
one of them, with **all data at rest stored in-region** and no data-zone
processing. So document content — corpus today, participant data later — stays
onshore. This is the same blocker flagged for the NDIS pilot, now resolved for
the document plane.

The split: a **second Foundry account in `australiaeast`** carries Content
Understanding, document embeddings and chat; the original account keeps
realtime voice (which ships to few regions and is a demo surface with no
customer data). `deploy_realtime` became a module flag to make that possible.

### What was built

| Piece                                               | Where                              |
| --------------------------------------------------- | ---------------------------------- |
| Search service managed identity                     | `modules/search`                   |
| `deploy_realtime` flag                              | `modules/foundry`                  |
| AU Foundry + blob/Foundry RBAC + `corpus` container | `envs/dev/main.tf`                 |
| `search_sku` default → `basic`                      | `envs/dev/variables.tf`            |
| Corpus → blob upload, facets as blob metadata       | `scripts/upload-corpus.ts`         |
| Data source, index, skillset, indexer               | `scripts/setup-search-pipeline.ts` |

`tofu validate` passes. **Nothing has been applied to Azure.**

Note the split: Tofu provisions infrastructure, the script creates the
pipeline. That is not a shortcut — indexers, skillsets and data sources are
Azure AI Search _data-plane_ objects, so neither `azurerm` nor `azapi` can
express them.

### Order of operations

```bash
cd infrastructure/tofu/envs/dev && tofu plan     # review: basic SKU + AU Foundry
tofu apply
# copy outputs into apps/web/.env.local:
#   AZURE_STORAGE_ACCOUNT_RESOURCE_ID, AZURE_AU_OPENAI_ENDPOINT,
#   AZURE_AU_EMBEDDING_DEPLOYMENT, AZURE_AU_FOUNDRY_ACCOUNT_ID,
#   AZURE_CORPUS_TENANT_ID (careercraft tenant uuid)
pnpm exec tsx scripts/upload-corpus.ts --dry     # works without credentials
pnpm exec tsx scripts/upload-corpus.ts
pnpm exec tsx scripts/setup-search-pipeline.ts --print   # inspect definitions
pnpm exec tsx scripts/setup-search-pipeline.ts --run
pnpm exec tsx scripts/setup-search-pipeline.ts --status  # poll
pnpm exec tsx scripts/build-graph.ts                     # rebuild graph on better chunks
```

### Unverified until first run

Three things cannot be settled without executing against Azure, and the
`--status` poller is built to surface all of them:

1. **Blob metadata field naming.** Projections read `/document/tenantid`,
   `/document/category` and so on. If the blob indexer namespaces custom
   metadata differently, those mappings come back empty and the paths need
   adjusting — content and vectors would still populate.
2. **`year` (string → `Edm.Int32`) and `tags` (comma string →
   `Collection(Edm.String)`).** Blob metadata is always string. Index
   projections have no mapping functions, so if AI Search doesn't coerce
   these, the fix is either a Shaper skill or making both fields strings.
   `tags` is the likelier of the two to fail.
3. **The five-minute per-document cap** — Content Understanding times out
   there _and still bills_. The 185-page Budget Statement and the four Agency
   Statement volumes are the candidates. `--status` calls this out by name
   rather than leaving a bare timeout.

### The storage decision

The lever with the best ratio is **vector width**. `EMBEDDING_DIMENSIONS` is
now env-configurable (`AZURE_SEARCH_VECTOR_DIMENSIONS`, defaults to 3072
— nothing changed yet). text-embedding-3-large supports Matryoshka
truncation, so dropping to 1024 cuts vector storage to roughly a third for a
small recall cost, and would fit the rest of the corpus on the free tier.
**It requires dropping and rebuilding the index** (AI Search treats
`vectorSearchDimensions` as immutable) and re-embedding every chunk — cheap in
dollars, ~30 minutes of runtime, and it would clear the playground and
incidents index data too. That is a destructive operation on working data, so
it has not been done.

The alternative is upgrading the search service from Free to Basic, which buys
~2GB and needs no re-index or quality tradeoff, at a real monthly cost. My
recommendation is dimension reduction now and a tier upgrade when there is
revenue to justify it — but the destructive step is yours to authorise.
