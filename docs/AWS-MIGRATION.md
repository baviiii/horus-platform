# Horus on AWS — migration runbook

> Built 2026-10-18/19, after the Azure startup credit ran out on 2026-10-15 and
> the whole Azure stack was deleted. The code now runs on either cloud; one
> environment variable picks which.

## The switch

`HORUS_AI_PROVIDER` decides where every AI call goes:

| Value             | Models                                                           | Embeddings    | Knowledge store          | Moderation         | Files |
| ----------------- | ---------------------------------------------------------------- | ------------- | ------------------------ | ------------------ | ----- |
| `azure` (default) | Foundry Agent Service + Azure OpenAI                             | Azure OpenAI  | Azure AI Search (hybrid) | Content Safety     | Blob  |
| `aws`             | Any Bedrock model via the AI SDK (default Claude Sonnet 4.6, AU) | Titan Text V2 | S3 Vectors (vector-only) | Bedrock Guardrails | S3    |
| `off`             | —                                                                | —             | —                        | —                  | —     |

`off` is the kill switch: every AI route answers **503** with
`{"code":"AI_UNAVAILABLE"}` before doing any work (tRPC returns
`SERVICE_UNAVAILABLE`). Use it whenever the configured cloud is gone; without
it callers get DNS failures and opaque 500s. `/api/health` reports the active
value as `ai`.

The Azure code is untouched behind the switch: setting it back to `azure`
restores the old behaviour exactly.

## What maps to what

| Piece           | Azure                                    | AWS                                                  | Code                                     |
| --------------- | ---------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Chat agent      | Foundry Agent Service, server-held agent | AI SDK tool loop (`streamText`) on any model         | `core/src/agent/run-ai-sdk.ts`           |
| `infer()` JSON  | `response_format: json_object`           | AI SDK structured output (`Output.object` / `.json`) | `core/src/inference/ai-sdk-json.ts`      |
| `/api/embed`    | text-embedding-3-small/large             | Titan V2 (256/512/1024 dims)                         | `core/src/clients/bedrock-embeddings.ts` |
| Knowledge store | AI Search index                          | S3 Vectors index, same function signatures           | `core/src/knowledge/store-s3vectors.ts`  |
| Moderation      | Content Safety, block at severity ≥ 4    | ApplyGuardrail, MEDIUM strength                      | `core/src/safety/guardrails.ts`          |
| Incident PII    | Azure Language                           | Comprehend DetectPiiEntities                         | `core/src/clients/language.ts`           |
| Incident photos | gpt-4o vision                            | Bedrock vision model                                 | `core/src/incidents/vision.ts`           |
| Files           | Blob container per tenant                | S3 prefix `t-<tenantId>/`                            | `core/src/clients/s3-storage.ts`         |
| Voice           | Realtime API over WebRTC                 | **not yet** — routes answer 503                      | see below                                |
| Infra           | `infrastructure/tofu/envs/dev`           | `infrastructure/tofu/envs/aws-dev`                   |                                          |

### Models

Model calls go through the Vercel AI SDK (`ai` plus one adapter per company),
so switching model, or company, is a setting, not a code change
(`core/src/clients/models.ts`). A setting is `provider:modelId`:

| Setting example                          | Provider       | Credentials                    |
| ---------------------------------------- | -------------- | ------------------------------ |
| `bedrock:au.anthropic.claude-sonnet-4-6` | Amazon Bedrock | `HORUS_AWS_*` keys             |
| `openai:gpt-5`                           | OpenAI         | `OPENAI_API_KEY`               |
| `anthropic:claude-sonnet-4-6`            | Anthropic      | `ANTHROPIC_API_KEY`            |
| `google:gemini-2.5-pro`                  | Google         | `GOOGLE_GENERATIVE_AI_API_KEY` |

A setting without one of those prefixes is a Bedrock model ID, so plain IDs
(`minimax.minimax-m2.5`) work. Only the model calls move: search, files,
moderation and PII detection stay on the cloud `HORUS_AI_PROVIDER` names.

- `HORUS_MODEL_FAST` / `HORUS_MODEL_DEEP`: the model per tier. Default
  `bedrock:au.anthropic.claude-sonnet-4-6`. The older `HORUS_CLAUDE_MODEL_*`
  names still work.
- `HORUS_MODEL_VISION`: the model for incident photos. Defaults to Sonnet 4.6,
  because not every text model reads images.
- Every Bedrock model used also needs `bedrock:InvokeModel` on its ARN in
  `infrastructure/tofu/envs/aws-dev/iam.tf`.
- `scripts/compare-models.ts` scores models on 21 CareerCraft questions through
  the real agent. First run (2026-10-30), correct of the 15 questions retrieval
  could answer: Sonnet 4.6, Haiku 4.5, MiniMax M2.5 and DeepSeek V3.2 14, Kimi
  K2.5 and gpt-oss-120b 13, Mistral Large 3 12. DeepSeek leaked tool-call markup
  into every answer, gpt-oss returned empty answers and its own citation style,
  and Mistral gave confident wrong figures. Cost per question: Sonnet $0.065,
  Haiku $0.021, Kimi $0.012, MiniMax $0.0076.

Found on the first live run (2026-10-29), Sydney account 293310830654:

- **`bedrock-mantle` (the Messages-API endpoint) answers 404 "model does not
  exist" for every Claude model on this account.** Use `bedrock-runtime`
  (InvokeModel / Converse), which the AI SDK does.
- **Current Claude models in Sydney are only callable through an inference
  profile.** `au.` routes to Sydney and Melbourne; `global.` routes anywhere.
- **Claude Sonnet 5 and Opus 5 are "not available for this account"** until
  AWS support enables them. Sonnet 4.6, Sonnet 4.5 (LEGACY) and Haiku 4.5 work.

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
2. **Open Bedrock in `ap-southeast-2`.** Submit Anthropic's one-time use-case
   form (the playground asks for it), then send one message to each model you
   will use, as admin. That accepts the model's terms, which the app's own key
   is not allowed to do.
3. **Check the model IDs and routing.** Use inference profile IDs (`au.…`),
   not bare model IDs. See **Models** above for what this account can call.
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
