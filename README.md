# Horus Platform

The intelligence layer enterprises don't want to build.

A standalone, multi-tenant, white-labelable B2B intelligence platform that productizes hybrid RAG, knowledge graphs, entity extraction, document intelligence, contradiction detection, and proactive alerting.

## Status

Pre-build. See [`PLAN.md`](./PLAN.md) for the full architecture, migration strategy, and 8-week phased build plan.

## What's here

- `PLAN.md` — Master build plan (start here).
- Everything else lands during Phase 0.

## What's coming

Standalone repo for Horus, separated from the careercraft-pages monorepo. Built as a full T3-style stack:

- Next.js 15 (App Router)
- tRPC v11 (with `@horus/sdk` as the type-safe client export)
- Prisma → Supabase Postgres
- Supabase Auth + custom API key system
- Azure AI Search (vector) + Cosmos Gremlin (graph) + Azure Blob (raw docs)
- Multi-tenancy via row-level isolation + per-tenant white-label config
- Background workers on Azure Container Apps Jobs

CareerCraft becomes the first reference customer, consuming Horus via the SDK.
