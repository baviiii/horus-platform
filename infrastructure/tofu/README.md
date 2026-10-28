# Horus Infrastructure — OpenTofu

Greenfield infra build for the multi-tenant Horus platform. Replaces the archived CareerCraft Bicep stack under `infrastructure/_legacy_careercraft/`.

## Layout

```
tofu/
  envs/
    aws-dev/      # AWS: S3, S3 Vectors, Bedrock Guardrail, app IAM user, budgets
                  #   (see docs/AWS-MIGRATION.md; selected by HORUS_AI_PROVIDER=aws)
    dev/          # dev environment — root module you run `tofu apply` from
  modules/
    storage/      # blob storage account + containers
    foundry/      # Azure AI Foundry: account + project + model deployments
                  #   + Grounding-with-Bing (optional) + data-plane RBAC
    search/       # Azure AI Search (knowledge store for session/tenant RAG)
```

Each `envs/<env>` folder is a self-contained Tofu root: own state, own variables, own plan. Modules under `modules/` are reusable across envs.

## The Foundry module

One **AIServices account with project management enabled** (the current
Cognitive-Services-based Foundry model, not the legacy hub/workspace kind) is
the management plane for everything AI:

- **Model deployments** — `gpt-4o` (chat agent), `text-embedding-3-large`
  (RAG), `gpt-realtime-2.1-mini` (full-duplex voice over WebRTC). All
  GlobalStandard. The realtime deployment goes through `azapi` because the
  azurerm provider's deployments API lags the newest models.
- **Foundry project** — the Agent Service data plane
  (`https://<account>.services.ai.azure.com/api/projects/<name>`). Agents
  auth with **Entra only** (never api-keys), so the module assigns
  **Foundry User** (`53ca6127-db72-4b80-b1b0-d745d6d5456d`, formerly
  "Azure AI User") to every developer principal.
- **Content Safety** — included in the account; same endpoint family + key.
- **Grounding with Bing Search** — `deploy_bing_grounding = true` provisions
  the Bing resource + project connection so agents can search the live web.
  ⚠️ The G1 SKU fails `SkuNotEligible` on sponsored/credit subscriptions —
  flip it on after moving to pay-as-you-go/EA.

`foundry_location` (default `eastus2`) is independent of the RG region:
realtime models ship to a handful of regions first, and eastus2 always has
everything. Storage + search stay in `location` (default `australiaeast`).

## Prerequisites

1. **OpenTofu** ≥ 1.6 — https://opentofu.org/docs/intro/install/
2. **Azure CLI** — `az login` so the providers (azurerm + azapi) can authenticate.
3. The Azure subscription you want to deploy into must be selected: `az account show`.

## First apply (dev)

```bash
cd infrastructure/tofu/envs/dev
cp terraform.tfvars.example terraform.tfvars   # optional — defaults already work
tofu init
tofu plan
tofu apply
```

This brings up:

- A resource group `rg-horus-dev` in `australiaeast`.
- A storage account `horusdev<6-hex>` with `documents` + `rendered` containers.
- The Foundry account + project + three model deployments (see above).
- Azure AI Search (`free` tier for the playground; `basic`+ for real tenants).

After apply, wire the web app:

```powershell
./print-horus-env.ps1   # prints every env var for apps/web/.env.local
```

That includes `AZURE_AI_PROJECT_ENDPOINT` (Agent Service),
`AZURE_OPENAI_REALTIME_DEPLOYMENT` (voice), and
`AZURE_CONTENT_SAFETY_ENDPOINT` (moderation) alongside the OpenAI + Search
values. Locally the Agent Service rides your `az login` session via
`DefaultAzureCredential` — no key needed or accepted.

State is stored **locally** (`terraform.tfstate`) for now — it's gitignored. We'll switch to Azure Blob remote state in a follow-up commit once the module set is stable.

## Tearing it down

```bash
tofu destroy
```

## Conventions

- Resource names follow `<kind>-<project>-<environment>` (e.g. `rg-horus-dev`). Globally-unique names strip hyphens and append a random suffix.
- Every resource gets `local.common_tags` — `project`, `environment`, `owner`, `managed_by = opentofu`.
- Multi-tenancy is enforced at the **data layer**, not the resource layer: a single storage account, a single search index, with `tenants/<tenantId>/...` blob prefixes and a `tenantId` filter on every query.

## What's next

1. Flip `deploy_bing_grounding = true` once the subscription is pay-as-you-go.
2. `document_intelligence` — OCR for scanned PDFs in the ingest pipeline.
3. `container_apps` — host Horus web + MCP (optional; Vercel works for web-only).
4. Remote state in Azure Blob.
