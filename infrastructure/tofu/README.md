# Horus Infrastructure — OpenTofu

Greenfield infra build for the multi-tenant Horus platform. Replaces the archived CareerCraft Bicep stack under `infrastructure/_legacy_careercraft/`.

## Layout

```
tofu/
  envs/
    dev/          # dev environment — root module you run `tofu apply` from
  modules/
    storage/      # blob storage account + containers
```

Each `envs/<env>` folder is a self-contained Tofu root: own state, own variables, own plan. Modules under `modules/` are reusable across envs.

## Prerequisites

1. **OpenTofu** ≥ 1.6 — https://opentofu.org/docs/intro/install/
2. **Azure CLI** — `az login` so the provider can authenticate.
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
- A storage account `horusdev<6-hex>` (lowercase, hyphen-stripped, random suffix because storage account names must be globally unique).
- Two blob containers: `documents` and `rendered`.

State is stored **locally** (`terraform.tfstate`) for now — it's gitignored. We'll switch to Azure Blob remote state in a follow-up commit once the module set is stable.

## Tearing it down

```bash
tofu destroy
```

## Conventions

- Resource names follow `<kind>-<project>-<environment>` (e.g. `rg-horus-dev`). Storage accounts strip hyphens and append a random suffix to satisfy Azure naming rules.
- Every resource gets `local.common_tags` — `project`, `environment`, `owner`, `managed_by = opentofu`.
- Multi-tenancy is enforced at the **data layer**, not the resource layer: a single storage account, a single search index, with `tenants/<tenantId>/...` blob prefixes and a `tenantId` filter on every query.

## What's next

Modules to add, in order:

1. `document_intelligence` — Azure AI Document Intelligence (S0) for PDF extraction.
2. `search` — Azure AI Search (Basic) with the `documents` index (32 fields + `tenantId`).
3. `openai` — Azure OpenAI with `text-embedding-3-large`, `gpt-4o-mini`, `gpt-4o` deployments.
4. `functions` — Function App (Consumption Y1) for the worker endpoints.
5. `graph` — Cosmos DB Gremlin (serverless) **or** Neo4j VM — pending decision (see `infrastructure/HARVEST.md`).
