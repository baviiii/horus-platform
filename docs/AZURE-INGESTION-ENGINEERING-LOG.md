# Azure Ingestion Pipeline — Engineering Log

> Every step, every error, every fix, with the actual code. Written 2026-08-06/07
> so the reasoning is auditable rather than taken on trust.
>
> Companion docs: `CAREERCRAFT-GRAPHRAG.md` (design), `RUNBOOK.md` (operations).

---

## Part 0 — Glossary

Terms used throughout. Skip if they're already familiar.

| Term                                  | What it means                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Control plane**                     | Azure's management API (`management.azure.com`). "Create me a search service." This is what Terraform/OpenTofu speaks.                                                                     |
| **Data plane**                        | A service's _own_ API (`myservice.search.windows.net`). "Create an index inside that service." Different endpoint, different auth. Terraform cannot reach here.                            |
| **Indexer**                           | A worker that lives _inside_ Azure AI Search. Crawls a data source on a schedule, runs a skillset, writes results to an index. You configure it once; it runs on Azure's machines forever. |
| **Data source**                       | A definition telling the indexer _where_ documents live (a blob container, in our case).                                                                                                   |
| **Skillset**                          | An ordered list of "skills" (operations) applied to each document — extract, chunk, embed.                                                                                                 |
| **Skill**                             | One operation in a skillset. We use two: `ContentUnderstandingSkill` and `AzureOpenAIEmbeddingSkill`.                                                                                      |
| **Enriched document**                 | An in-memory tree the indexer builds per document as skills run. Paths look like `/document/text_sections/*/content`. Skills read from paths and write new branches into it.               |
| **Index projection**                  | The instruction that turns one enriched document into _many_ index rows — one per chunk. Without it, a 60-chunk PDF would be a single row.                                                 |
| **`context`** with `/*`               | On a skill, means "run once per element of this array." How the embedding skill processes 60 chunks without a loop.                                                                        |
| **Content Understanding**             | Azure's document-analysis service. Reads layout, keeps tables as Markdown, chunks semantically. The successor to calling Document Intelligence yourself.                                   |
| **Managed identity**                  | An Azure-issued identity attached to a resource, so it can authenticate to other resources without keys or passwords.                                                                      |
| **RBAC**                              | Role-Based Access Control. Grants like "Storage Blob Data Reader" assigned to a principal (user or managed identity) over a scope (a resource).                                            |
| **Principal**                         | Whoever is acting — a person, or a service's managed identity. Identified by an `object_id` / `principal_id` GUID.                                                                         |
| **`ForceNew` / "forces replacement"** | A Terraform plan marker: this attribute can't be changed in place, so the resource must be **destroyed and recreated**.                                                                    |
| **Drift**                             | When real infrastructure no longer matches what the config says. Terraform "fixes" drift — sometimes destructively.                                                                        |
| **OData filter**                      | The query syntax AI Search uses for filtering, e.g. `category eq 'budget'`.                                                                                                                |
| **Edm.String / Edm.Int32**            | AI Search field types. `Edm` = Entity Data Model, inherited from OData. `Collection(Edm.String)` is an array of strings.                                                                   |
| **`azapi`**                           | A Terraform provider that talks to raw Azure ARM APIs, used when `azurerm` lacks a resource. Still control-plane only.                                                                     |

---

## Part 1 — The problem we were solving

Our ingestion used `unpdf` (a JavaScript PDF text extractor) running in a Node
script. It reads the text layer of a PDF in reading order. For prose that's
fine. For **tables it is not**, and budget papers keep their money in tables.

Evidence — a real relationship from the knowledge graph, with the sentence the
extractor took it from:

```
Government of SA --funds--> High Productivity Vehicle Network
  evidence: "High Productivity Vehicle Network (SA) — Planning(e) Jun 2027 2 148 17 000"
```

`2 148 17 000` is a **table row flattened into a string**. Three columns
(estimated completion, this year's allocation, total project cost, in
thousands) merged with no separator. The model captured that money exists; it
cannot tell you which number means what.

**Goal:** hand extraction to Azure Content Understanding, which reconstructs
tables as Markdown, and put the document plane in Australia for data residency.

### Why Content Understanding and not the Document Layout skill

Both exist. Microsoft's own comparison, from the Content Understanding skill docs:

> Tables and figures are output in Markdown format, making them easier for large
> language models to understand. In contrast, the Document Layout skill outputs
> tables and figures as plain text, **which can result in information loss**.
>
> For tables that span multiple pages, the Azure Content Understanding skill can
> recognize and extract cross-page tables **as a single unit**.
>
> The Azure Content Understanding skill is **more cost effective** than the
> Document Layout skill.

Better and cheaper, and cross-page tables matter because Agency Statements run
financial tables across page breaks.

---

## Part 2 — Architecture before and after

### Before (what produced the current graph)

```
your machine ── reads PDF from disk
             ── unpdf extracts text          ← tables flattened here
             ── chunkText() every ~3,200 chars
             ── POST to Azure OpenAI for embeddings, vectors return
             ── POST batches to AI Search
             ── write Document row to Postgres
```

Every step runs on your machine. If it dies at document 40, you restart and
work out where it stopped.

### After

```
you ── upload PDFs to a blob container (once)
   └── register 4 JSON definitions with AI Search (once)

Azure, on a 12-hour schedule, per document:
   indexer picks up blob
     → Content Understanding: layout analysis, tables as Markdown, semantic chunks
     → AzureOpenAIEmbeddingSkill: one vector per chunk
     → index projections: one index row per chunk
```

Your machine is not in that loop.

### What did NOT change

The index **schema** is the same. Which means `searchKnowledge()`,
`build-graph.ts`, the agent's `graph_lookup` tool, `intelligence.brief` and
every UI page work unchanged. Only the quality of the chunks improves.

---

## Part 3 — Why Terraform can't do all of it

`azurerm` provides `azurerm_search_service` (the service) and **nothing else
for Search**. There are four open GitHub issues requesting the rest:

```
#25100  Support for AI Search Index resource type
#26145  Support for azurerm_search_indexer
#26146  Support for azurerm_search_skillset
#26243  Support for azurerm_search_index
```

The reason is the control-plane/data-plane split in the glossary. `azapi`
doesn't help — it also speaks ARM.

Options considered:

| Option                         | Verdict                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `restapi` Terraform provider   | Genuinely works; puts definitions in state. Rejected because JSON-in-HCL is painful and it can't express operations.  |
| `null_resource` + `local-exec` | Rejected — provisioners don't track updates, so changing a skillset doesn't reliably re-run.                          |
| **A script**                   | **Chosen** — because the pipeline needs _operational verbs_ Terraform cannot express: `--run`, `--status`, `--reset`. |

So: **Tofu owns resources, the script owns the pipeline definition and its
operations.**

---

## Part 4 — Infrastructure changes, file by file

`git diff --stat` on the Tofu tree:

```
 envs/dev/main.tf             | 64 ++++++++++++++++++-
 envs/dev/outputs.tf          | 53 ++++++++++++++++
 envs/dev/variables.tf        | 26 +++++++-
 modules/foundry/main.tf      |  8 +++
 modules/foundry/outputs.tf   |  9 ++-
 modules/foundry/variables.tf |  6 +++
 modules/search/main.tf       |  7 +++
 modules/search/outputs.tf    |  5 ++
 8 files changed, 172 insertions(+), 6 deletions(-)
```

### 4.1 `modules/search/main.tf` — managed identity

```hcl
  # Indexers authenticate to blob storage and to the Foundry resource that
  # bills skillset execution as this identity — keyless, so no connection
  # strings end up inside data-source or skillset definitions.
  identity {
    type = "SystemAssigned"
  }
```

**Why:** the data source uses `ResourceId=...` with no key. Azure interprets
that as "use your own identity." Without an identity there is nothing to
authenticate as.

### 4.2 `modules/foundry/main.tf` — the landmine fix

```hcl
  # Must be declared explicitly. azurerm gained this argument in 4.x and it
  # defaults to false, so leaving it unset reads as drift against an account
  # that already has project management on — and the provider "fixes" that by
  # REPLACING the account, taking every model deployment with it.
  project_management_enabled = true
```

Explained fully in Part 5, bug #1.

### 4.3 `modules/foundry/` — optional realtime voice

```hcl
resource "azapi_resource" "realtime" {
  count = var.deploy_realtime ? 1 : 0
  ...
}
```

```hcl
variable "deploy_realtime" {
  description = "Deploy the realtime speech-to-speech model. Off for regional accounts (e.g. australiaeast) that carry document workloads but not voice — realtime ships to a handful of regions only."
  type        = bool
  default     = true
}
```

**Why:** the Foundry account sat in `eastus2` _because_ realtime voice ships to
few regions. To put documents in Australia without losing voice, the Australian
account needed to skip that deployment. `default = true` keeps existing
behaviour unchanged.

### 4.4 `envs/dev/main.tf` — the Australian document plane

```hcl
module "foundry_au" {
  count  = var.deploy_au_document_plane ? 1 : 0
  source = "../../modules/foundry"

  location    = var.au_document_location
  name_prefix = "${local.name_prefix}-au"
  tags        = merge(local.common_tags, { data_residency = "australia" })

  chat_model_name = var.chat_model
  chat_capacity   = var.chat_capacity
  # Voice lives in the primary account only.
  deploy_realtime       = false
  deploy_bing_grounding = false
}
```

**Why a second account rather than moving the first:** Content Understanding
runs in ~12 regions, `australiaeast` among them, with all data at rest kept
in-region and no data-zone processing. Realtime voice does not run there. So
documents go onshore; voice — a demo surface with no customer data — stays put.

### 4.5 `envs/dev/main.tf` — RBAC

```hcl
resource "azurerm_role_assignment" "search_reads_blobs" {
  scope                = module.storage.storage_account_id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = module.search.principal_id
}

# Lets the skillset invoke Content Understanding on the AU account.
resource "azurerm_role_assignment" "search_uses_au_foundry" {
  scope                = module.foundry_au[0].account_id
  role_definition_name = "Cognitive Services User"
  principal_id         = module.search.principal_id
}

# Operators need data-plane write access to push the corpus into blob storage.
# Owner/Contributor at the control plane does NOT grant this — blob data
# operations are a separate RBAC surface, which is why an unassigned developer
# gets AuthorizationPermissionMismatch despite owning the subscription.
resource "azurerm_role_assignment" "developer_writes_blobs" {
  scope                = module.storage.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}
```

That third one is the non-obvious lesson: **owning a subscription does not let
you read or write blob data.** Control-plane ownership and data-plane
operations are separate permission systems.

### 4.6 `envs/dev/variables.tf`

```hcl
variable "search_sku" {
  description = "Azure AI Search SKU. free = 50 MB total and a cap of 3 indexers/skillsets/data sources — too small for the document pipeline; basic is the floor for the corpus indexer."
  default     = "basic"      # was "free"
}

variable "au_document_location" {
  default = "australiaeast"

  validation {
    # Content Understanding GA regions, verified 2026-08-01.
    condition = contains([
      "australiaeast", "eastus", "eastus2", "japaneast", "northeurope",
      "southcentralus", "southeastasia", "swedencentral", "uksouth",
      "westeurope", "westus", "westus3",
    ], var.au_document_location)
    error_message = "au_document_location must be a region where Azure Content Understanding is available."
  }
}
```

The validation block means a typo or an unsupported region fails at `plan`
rather than halfway through an apply.

---

## Part 5 — Every bug, in the order it happened

### Bug 1 — the plan wanted to destroy the working Foundry account

**Command:**

```bash
tofu plan
```

**Output:**

```
Plan: 18 to add, 0 to change, 8 to destroy.

# module.foundry.azurerm_cognitive_account.main must be replaced
    ~ project_management_enabled = true -> false # forces replacement
```

**What that means:** `horusdevai56e136` — the account running gpt-4o,
text-embedding-3-large, realtime voice, the Agent Service project and Content
Safety — was going to be **deleted and rebuilt**, taking every model deployment
with it. The playground, voice, workspace chat and incident drafting would all
have broken.

**Diagnosis:** azurerm 4.80.0 added a `project_management_enabled` argument.
The module never set it, so the config default (`false`) was compared against
reality (`true`, set by an `azapi_update_resource` PATCH written back when
azurerm had no such argument). The provider saw drift and resolved it the only
way it can for a `ForceNew` attribute — replacement.

**Fix:** one line, declaring reality explicitly.

```hcl
project_management_enabled = true
```

**Result:**

```
Plan: 11 to add, 1 to change, 1 to destroy.
```

The single destroy is the search service, which is unavoidable — see bug 2.

**Lesson:** this was pre-existing and unrelated to our work. **Any** future
`tofu apply`, for any reason, would have fired it.

---

### Bug 2 — `409 ServiceDeleting`

**Why the search service must be destroyed at all:** Azure does not allow
changing a search service's pricing tier in place. Free → Basic is a
replacement, full stop.

**Error:**

```
Error: creating Search Service ... unexpected status 409 (409 Conflict)
ServiceDeleting: Cannot provision service named 'horus-dev-srch-a45b90'
because a background operation is still in progress, please try again with
exponential backoff or with a different service name
```

**Diagnosis:** the old service was deleted, but Azure holds the _name_ for
several minutes while cleanup finishes.

**Decision:** wait for the same name rather than forcing a new one. Keeping the
name meant `AZURE_SEARCH_ENDPOINT` stayed identical — only the API key rotated.

**Outcome:** creation eventually took ~10 minutes.

---

### Bug 3 — my retry loop reported a false success

**The broken code:**

```bash
if tofu apply -auto-approve | tail -12; then
  echo "APPLY SUCCEEDED"; break
fi
```

**What went wrong:** in a pipeline, `$?` is the exit status of the **last**
command — `tail` — which always succeeds. So the `if` was testing `tail`, not
`tofu apply`. It printed `APPLY SUCCEEDED` while the apply had failed with the
same 409.

**Fix:** redirect to a file instead of piping, so the exit code is the apply's.

```bash
tofu apply -auto-approve -no-color > /tmp/apply.log 2>&1; echo "EXIT CODE: $?"
```

**Lesson:** never test the exit status of a piped command without `PIPESTATUS`.
This is a genuine mistake that produced a wrong status report.

---

### Bug 4 — `403 AuthorizationPermissionMismatch` on upload

**Command:**

```bash
pnpm exec tsx scripts/upload-corpus.ts
```

**Error:**

```
statusCode: 403, errorCode: 'AuthorizationPermissionMismatch'
```

**Diagnosis:** the script authenticates with `DefaultAzureCredential` (your
`az login` identity). The Tofu granted the **search service** blob read, but
nothing granted **you** blob write. Subscription ownership does not include
blob data operations.

**Fix:** the `developer_writes_blobs` role assignment in §4.5.

**Result:** `86 uploaded, 0 unchanged, 0 failed`.

---

### Bug 5 — six REST schema property mismatches

The definitions were written using **JS SDK** property names, but the script
calls the **REST API** directly, and they differ. Each returned an HTTP 400
naming the exact offending property, so this was mechanical.

| Attempt | Error                                                                    | Fix                                                           |
| ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1       | `The property 'hidden' does not exist`                                   | `hidden: true` → `retrievable: false`                         |
| 2       | `The property 'vectorSearchDimensions' does not exist`                   | → `dimensions`                                                |
| 3       | (same class)                                                             | `vectorSearchProfileName` → `vectorSearchProfile`             |
| 4       | (same class)                                                             | `algorithmConfigurationName` → `algorithm`                    |
| 5       | `Index key field must have the keyword analyzer set`                     | added `analyzer: 'keyword'` to the key field                  |
| 6       | `'SubdomainUrl' parameter should reference a valid AI Services resource` | used `*.cognitiveservices.azure.com`, not the OpenAI hostname |

Final vector field:

```ts
{
  name: 'contentVector',
  type: 'Collection(Edm.Single)',
  searchable: true,
  // REST property names differ from the JS SDK's: the SDK exposes
  // `hidden` / `vectorSearchProfileName`, the wire format wants
  // `retrievable` / `vectorSearchProfile`.
  retrievable: false,
  dimensions: EMBEDDING_DIMENSIONS,
  vectorSearchProfile: 'vector-profile',
}
```

Key field — index projections generate their own keys, which must survive
tokenisation intact:

```ts
{ name: 'id', type: 'Edm.String', key: true, filterable: true, analyzer: 'keyword' }
```

Skillset billing block — `subdomainUrl` is validated as an _AI Services_
resource, so the OpenAI hostname is rejected even though both resolve to the
same account:

```ts
cognitiveServices: {
  '@odata.type': '#Microsoft.Azure.Search.AIServicesByIdentity',
  subdomainUrl: required('AZURE_AU_COGNITIVE_ENDPOINT'),
  identity: null, // null = the service's system-assigned identity
},
```

**Sub-problem:** fixing the key field failed with
`Existing field 'id' cannot be changed` — AI Search treats existing field
attributes as **immutable**. New fields can be added; existing ones cannot be
altered. (The same rule bit us earlier on `chunkIx`.)

**Fix:** a `--recreate-index` flag, safe only because the corpus is rebuildable
from blob.

```ts
// AI Search treats existing field attributes as immutable, so any schema
// change beyond adding new fields needs the index dropped first. Safe while
// the corpus is re-indexable from blob — never on an index you can't rebuild.
if (process.argv.includes('--recreate-index')) {
  await searchApi('DELETE', `indexes/${INDEX_NAME}`).catch(() => undefined);
}
```

---

### Bug 6 — the type conversion failure (the one that was predicted)

**Status output:**

```
last run: transientFailure · processed=6 failed=6
✗ ...au-disability-strategy.pdf: Could not index document because some of
  the data in the document was not valid.
```

**Important:** Content Understanding was working. Documents were being read and
chunked. The failure was purely **writing chunks into the index**.

**Diagnosis:** blob metadata values are **always strings** — there is no typed
metadata in Azure Blob Storage. We were writing:

```ts
metadata: { year: String(doc.year), tags: safeMeta(doc.tags.join(',')) }
```

…into index fields declared as:

```ts
{ name: 'year', type: 'Edm.Int32', ... }
{ name: 'tags', type: 'Collection(Edm.String)', ... }
```

Indexer `fieldMappings` support mapping functions (`splitAndTrim`,
`base64Encode`) that could convert these — but **index projections do not**.
Projections are pure path-to-field mappings. So `"2026"` (string) was being
handed to an `Int32` field, and `"a,b,c"` to a collection.

**Fix — index side:**

```ts
// Blob metadata is always a string, and index projections have no
// mapping functions to coerce it — so these are strings on the wire.
// `year` filters as 'eq "2026"'; `tags` is a comma-joined searchable
// string matched with search.ismatch rather than a collection.
{ name: 'year', type: 'Edm.String', filterable: true, facetable: true },
{ name: 'tags', type: 'Edm.String', filterable: true, searchable: true },
```

**Fix — query side** (`packages/core/src/knowledge/store.ts`):

```ts
// year and tags arrive from blob metadata, which is string-only — the
// indexer cannot coerce them, so both are stored as strings.
if (filters.year) parts.push(`year eq '${Math.floor(filters.year)}'`);
for (const tag of filters.tags ?? []) {
  // tags is a comma-joined string; full-text match is the exact-enough
  // equivalent of a collection membership test for slug-style tags.
  parts.push(`search.ismatch('${escapeOData(tag)}', 'tags')`);
}
```

`search.ismatch` runs a full-text match inside an OData filter — the workable
substitute for collection membership. Tag values are slugs (`state-budget`,
`defence`), so this is exact enough in practice.

**Result:**

```
last run: inProgress · processed=11 failed=0
```

---

## Part 6 — The pipeline definitions explained

`scripts/setup-search-pipeline.ts` is ~410 lines that make **four HTTP calls**.
It processes zero documents; it registers definitions and exits.

```ts
await searchApi('PUT', `datasources/${DATASOURCE_NAME}`, dataSource());
await searchApi('PUT', `indexes/${INDEX_NAME}`, index());
await searchApi('PUT', `skillsets/${SKILLSET_NAME}`, skillset());
await searchApi('PUT', `indexers/${INDEXER_NAME}`, indexer());
```

Order matters: the indexer references the other three by name.
`PUT` is create-or-update, so re-running is safe.

### 6.1 Data source — _where are the documents?_

```ts
{
  type: 'azureblob',
  // Keyless: ResourceId= with no key makes the service use its identity.
  credentials: { connectionString: `ResourceId=${accountId};` },
  container: { name: 'corpus' },
  dataChangeDetectionPolicy: {
    '@odata.type': '#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy',
    highWaterMarkColumnName: 'metadata_storage_last_modified',
  },
}
```

Change detection means unchanged blobs are skipped on later runs — you only pay
to process what actually changed.

### 6.2 Skillset — _what work is done to each document?_

```ts
{
  '@odata.type': '#Microsoft.Skills.Util.ContentUnderstandingSkill',
  context: '/document',
  extractionOptions: ['locationMetadata'],
  chunkingProperties: {
    method: 'semantic',   // respects paragraph boundaries and table edges
    unit: 'tokens',
    maximumLength: 800,
  },
  inputs:  [{ name: 'file_data',     source: '/document/file_data' }],
  outputs: [{ name: 'text_sections', targetName: 'text_sections' }],
}
```

Then embedding, once per chunk:

```ts
{
  '@odata.type': '#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill',
  context: '/document/text_sections/*',     // ← the /* fans out per element
  inputs:  [{ name: 'text',      source: '/document/text_sections/*/content' }],
  outputs: [{ name: 'embedding', targetName: 'contentVector' }],
}
```

Content Understanding does extraction **and** chunking, so there is no separate
Text Split skill.

### 6.3 Index projections — _one document becomes many rows_

```ts
indexProjections: {
  selectors: [{
    targetIndexName: INDEX_NAME,
    parentKeyFieldName: 'parentId',
    sourceContext: '/document/text_sections/*',   // ← fan out on this array
    mappings: [
      { name: 'content',       source: '/document/text_sections/*/content' },
      { name: 'contentVector', source: '/document/text_sections/*/contentVector' },
      { name: 'pageNumber',    source: '/document/text_sections/*/locationMetadata/pageNumberFrom' },
      // Document-level values repeat onto every chunk (no /* in the path).
      { name: 'tenantId', source: '/document/tenantid' },
      { name: 'category', source: '/document/category' },
      { name: 'year',     source: '/document/year' },
    ],
  }],
  parameters: { projectionMode: 'skipIndexingParentDocuments' },
}
```

`sourceContext` is the mechanism: _emit one index row per element of this array_.
Paths **with** `/*` are per-chunk; paths **without** are copied onto every chunk.
`skipIndexingParentDocuments` means the PDF itself never becomes a row.

### 6.4 Indexer — _wire it together and schedule it_

```ts
{
  dataSourceName: DATASOURCE_NAME,
  skillsetName:   SKILLSET_NAME,
  targetIndexName: INDEX_NAME,
  schedule: { interval: 'PT12H' },
  parameters: {
    batchSize: 1,
    maxFailedItems: 5,
    configuration: {
      allowSkillsetToReadFileData: true,
      dataToExtract: 'allMetadata',
    },
  },
}
```

**`allowSkillsetToReadFileData: true` is the flag that matters most.** It is
what materialises `/document/file_data`. Without it, Content Understanding
receives nothing and the skillset silently produces empty output.

`dataToExtract: 'allMetadata'` is what surfaces our custom blob metadata
(`tenantid`, `category`, `year`) onto the enriched document.

---

## Part 7 — Why blob metadata carries tenantId

`upload-corpus.ts` stamps values onto each blob:

```ts
// tenantid/sessionid/sourcetype ride along as metadata rather than
// being injected downstream: index projections can only map from paths
// that exist on the enriched document, so there is nowhere to express
// a constant. Carrying them here keeps the projection a pure mapping.
metadata: {
  manifestid: doc.id,
  tenantid:   tenantId,
  sessionid:  'workspace',
  sourcetype: 'pdf',
  category:   safeMeta(doc.category),
  year:       String(doc.year),
  tags:       safeMeta(doc.tags.join(',')),
}
```

Index projections have no way to express a literal constant. Every value must
come from a path on the enriched document. Putting these in blob metadata makes
them paths.

---

## Part 8 — Current state (2026-08-06, run in progress)

```
indexer=horus-knowledge-corpus-indexer overall=running
  last run: inProgress · processed=33 failed=0
```

**Resources now live:**

| Resource               | Name                                 | Region              |
| ---------------------- | ------------------------------------ | ------------------- |
| AI Search              | `horus-dev-srch-a45b90` (**Basic**)  | australiaeast       |
| Foundry (documents)    | `horusdevauaib2fee0`                 | **australiaeast**   |
| Foundry (voice/agents) | `horusdevai56e136`                   | eastus2 (untouched) |
| Storage                | `horusdev5a39ae`, container `corpus` | australiaeast       |

**86 documents uploaded. 33 processed, 0 failed** at time of writing.

### Two documents exceed the size limit

```
! sa-workforce-strategy.pdf: 84,814,097 bytes
! sa-green-iron-steel.pdf:   17,775,337 bytes
   exceeds the maximum size 16,777,216 bytes for document extraction
   for your current service tier
```

Basic tier caps document _extraction_ at 16 MB. These two index their metadata
only — effectively absent from the corpus. Options: split them, compress them,
or move to a higher tier. Two of 86; deferred, not forgotten.

### Unknowns, resolved and outstanding

| #   | Unknown                       | Status                                                                                                                                                                                                      |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blob metadata field naming    | ✅ **Resolved** — documents index, so `/document/tenantid` resolves                                                                                                                                         |
| 2   | `year`/`tags` type conversion | ✅ **Resolved** — bug 6                                                                                                                                                                                     |
| 3   | 5-minute per-document cap     | ⏳ **Outstanding** — the 185-page Budget Statement and four Agency Statement volumes are candidates. Content Understanding times out there **and still bills.** `--status` names it explicitly if it fires. |

---

## Part 9 — Also built during this work

### The careers extraction profile

The graph had 1,859 entities but only **3% of edges touched an occupation or
skill**. Cause: the extraction prompt caps each batch at ~15 entities, and in a
government document programs and policies win that budget every time.

`EXTRACTION_PROFILES` in `packages/core/src/entities/extract.ts` adds a second
prompt that spends the same budget on the career pathway instead.

**Validated against Australian Jobs 2026, same chunks, both profiles:**

|                                  | general | careers     |
| -------------------------------- | ------- | ----------- |
| Career-relevant entities         | 10 / 15 | **14 / 15** |
| Pathway edges                    | 7       | **13**      |
| Occupations                      | 5       | **9**       |
| `sector --employs--> occupation` | 0       | **6**       |

Output shape from the careers profile:

```
Finance, Technology and Business --employs--> AI Engineer --requires--> AI literacy
```

That is the traversable chain a "what should I study" question needs, and no
single passage in the corpus contains it.

Run with:

```bash
pnpm exec tsx scripts/build-graph.ts --profile careers
```

---

## Part 10 — Command reference

```bash
# Infrastructure
cd infrastructure/tofu/envs/dev
tofu plan                      # ALWAYS review before apply
tofu apply

# Corpus
pnpm exec tsx scripts/upload-corpus.ts            # --dry works without credentials
pnpm exec tsx scripts/setup-search-pipeline.ts    # register definitions
pnpm exec tsx scripts/setup-search-pipeline.ts --print           # inspect JSON, no calls
pnpm exec tsx scripts/setup-search-pipeline.ts --run             # process now
pnpm exec tsx scripts/setup-search-pipeline.ts --status          # job sheet
pnpm exec tsx scripts/setup-search-pipeline.ts --reset --run     # full re-crawl
pnpm exec tsx scripts/setup-search-pipeline.ts --recreate-index  # schema changes

# Graph
pnpm exec tsx scripts/build-graph.ts                    # funding/budget layer
pnpm exec tsx scripts/build-graph.ts --profile careers  # pathway layer
pnpm exec tsx scripts/dedupe-graph.ts --dry             # preview merges
```

---

## Part 11 — Lessons worth keeping

1. **Always `plan` before `apply`.** It caught a config landmine that would have
   destroyed a working Foundry account and every model deployment on it.
2. **Control plane ≠ data plane.** Owning a subscription grants neither blob data
   access nor the ability to create a search index.
3. **AI Search field attributes are immutable.** Add fields freely; changing one
   means rebuilding the index. Design the schema as if migrations are expensive,
   because they are.
4. **Blob metadata is string-only,** and index projections cannot coerce types.
   Design index fields around what the source can actually deliver.
5. **Never test the exit code of a piped command.** It reports the last command
   in the pipe, not the one you care about.
6. **The failure mode moved.** It used to be "my script died at document 40."
   It is now "read the indexer's execution history." That is a better place for
   failure to live.
