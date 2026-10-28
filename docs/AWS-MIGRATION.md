# Horus on AWS — migration runbook

> Built 2026-10-18/19, after the Azure startup credit ran out on 2026-10-15 and
> the whole Azure stack was deleted. The code now runs on either cloud; one
> environment variable picks which.

## The switch

`HORUS_AI_PROVIDER` decides where every AI call goes:

| Value             | Models                                             | Embeddings    | Knowledge store          | Moderation         | Files |
| ----------------- | -------------------------------------------------- | ------------- | ------------------------ | ------------------ | ----- |
| `azure` (default) | Foundry Agent Service + Azure OpenAI               | Azure OpenAI  | Azure AI Search (hybrid) | Content Safety     | Blob  |
| `aws`             | Claude on Bedrock (Messages API, `bedrock-mantle`) | Titan Text V2 | S3 Vectors (vector-only) | Bedrock Guardrails | S3    |
| `off`             | —                                                  | —             | —                        | —                  | —     |

`off` is the kill switch: every AI route answers **503** with
`{"code":"AI_UNAVAILABLE"}` before doing any work (tRPC returns
`SERVICE_UNAVAILABLE`). Use it whenever the configured cloud is gone; without
it callers get DNS failures and opaque 500s. `/api/health` reports the active
value as `ai`.

The Azure code is untouched behind the switch: setting it back to `azure`
restores the old behaviour exactly.

## What maps to what

| Piece           | Azure                                    | AWS                                                       | Code                                     |
| --------------- | ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Chat agent      | Foundry Agent Service, server-held agent | Manual streaming tool loop on Claude                      | `core/src/agent/run-claude.ts`           |
| `infer()` JSON  | `response_format: json_object`           | Forced `respond` tool (Bedrock has no structured outputs) | `core/src/inference/claude-json.ts`      |
| `/api/embed`    | text-embedding-3-small/large             | Titan V2 (256/512/1024 dims)                              | `core/src/clients/bedrock-embeddings.ts` |
| Knowledge store | AI Search index                          | S3 Vectors index, same function signatures                | `core/src/knowledge/store-s3vectors.ts`  |
| Moderation      | Content Safety, block at severity ≥ 4    | ApplyGuardrail, MEDIUM strength                           | `core/src/safety/guardrails.ts`          |
| Incident PII    | Azure Language                           | Comprehend DetectPiiEntities                              | `core/src/clients/language.ts`           |
| Incident photos | gpt-4o vision                            | Claude vision                                             | `core/src/incidents/vision.ts`           |
| Files           | Blob container per tenant                | S3 prefix `t-<tenantId>/`                                 | `core/src/clients/s3-storage.ts`         |
| Voice           | Realtime API over WebRTC                 | **not yet** — routes answer 503                           | see below                                |
| Infra           | `infrastructure/tofu/envs/dev`           | `infrastructure/tofu/envs/aws-dev`                        |                                          |

### Models

Both tiers default to **Claude Opus 5** (`anthropic.claude-opus-5`). The
refusal fallback (SDK middleware, since Bedrock has no server-side
`fallbacks`) retries a declined request on `anthropic.claude-opus-4-8`.
Override per environment:

- `HORUS_CLAUDE_MODEL_FAST` / `HORUS_CLAUDE_MODEL_DEEP` — set FAST to
  `anthropic.claude-sonnet-5` or `anthropic.claude-haiku-4-5` to stretch
  credits on the high-volume routes (chat, `/api/infer` default tier).
- `HORUS_CLAUDE_FALLBACK_MODEL` — `none` disables the fallback.
- `HORUS_CLAUDE_EFFORT` — `low`…`max` for the chat agent; unset is the model
  default.

### Behaviour differences to expect

- **Retrieval is vector-only.** AI Search mixed in BM25 keyword scoring; S3
  Vectors doesn't. Exact-name lookups (a program name, an acronym) can rank
  lower. Watch CareerCraft answers for this first.
- **Scores are cosine similarity** (0–1), not AI Search's hybrid scores.
  Anything that compares a score to a fixed threshold needs re-checking.
- **No Bing grounding.** Bedrock has no web-search tool; the agent's
  `fetch_page` still works.
- **Source listing scans the index** (S3 Vectors has no list-by-filter). It's
  cached for 60 s per process; fine at corpus scale.

## Day one, once AWS Activate credits are on the account

1. **Lock the account down.** MFA on root, an admin user or Identity Center
   login for yourself, and a **spend limit** in AWS Settings → Billing.
2. **Open Bedrock in `ap-southeast-2`** and confirm access to Claude Opus 5,
   Claude Opus 4.8 and Titan Text Embeddings V2. Anthropic models may ask for
   a one-time use-case form. Run one prompt in the playground for each Claude
   model so the account is subscribed before the app calls it.
3. **Check the model IDs and routing.** The defaults assume the IDs in the
   table above on the global endpoint. For AU-only inference (résumé data),
   confirm the AU profile ID in the console and set the two
   `HORUS_CLAUDE_MODEL_*` variables to it.
4. **Apply the infrastructure** — plan first, then apply:
   ```bash
   cd infrastructure/tofu/envs/aws-dev
   cp terraform.tfvars.example terraform.tfvars   # set alert_email
   tofu init && tofu plan -out tfplan && tofu apply tfplan
   ```
   Creates: documents bucket, vector bucket + `horus-knowledge` and
   `horus-playground` indexes, the moderation guardrail, the `horus-dev-app`
   IAM user + key, and two budgets (gross burn before credits; real money
   after credits, alerting at $1).
5. **Confirm the budget alert emails** AWS sends to `alert_email`.
6. **Local env:** `./print-horus-env.ps1` → paste into `apps/web/.env.local`.
7. **Smoke test:** `pnpm exec tsx scripts/verify-aws.ts` — 8 checks covering
   Claude, Titan, the vector store, the agent loop, Guardrails, Comprehend and
   S3. All must pass.
8. **Load the corpus** from the Azure backup (no PDF re-extraction):
   `pnpm exec tsx scripts/aws-load-corpus.ts` (try `--dry` first). Keeps the
   original `sourceId`s, so Postgres `Document` rows and the knowledge graph
   still line up.
9. **Vercel (production):** add the same `HORUS_*` variables, set
   `HORUS_AI_PROVIDER=aws`, redeploy. The names are `HORUS_AWS_*`, not
   `AWS_*` — Vercel reserves those for its own Lambda role. Then check
   `/api/health` reports `"ai":"aws"` and ask CareerCraft's chat a question.

## Not migrated yet

- **Voice** (playground voice, Faircopy's listen-only interview voice). Azure's
  realtime model took WebRTC straight from the browser; Amazon Nova Sonic needs
  a relay server holding the stream, which Vercel can't host. Until it exists,
  both voice session routes answer 503 `VOICE_UNAVAILABLE` — Faircopy should
  fall back to typed answers.
- **interview-coach-mcp hosting** (separate repo). **App Runner is closed to
  new customers since 2026-04-30**, so it isn't an option. Choices: Lambda
  with a container image + function URL (≈$0 idle; needs the MCP server in
  stateless HTTP mode) or ECS Express Mode (simplest, but a load balancer
  costs ~US$20+/month idle). The voice relay will need ECS too, so if both
  land there they can share one cluster.
- **Automated PDF ingestion for new corpus documents.** Azure's indexer +
  Content Understanding did this hands-off. On AWS, new PDFs currently go
  through the in-app `ingestPdf` path (text extraction, weaker on tables).
  Bedrock Knowledge Bases or Bedrock Data Automation are the candidates when
  the corpus next grows.

## Right now, before AWS exists

Production still has the old Azure variables pointing at deleted resources.
Deploying this code with `HORUS_AI_PROVIDER=off` in Vercel turns the broken
calls into clean 503s. Check the working tree before deploying: there's
uncommitted tenant-invite work that needs the `tenant_invites` table created
in production first (see `project-tenant-invites`).
