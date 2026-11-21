# Horus Platform

The intelligence layer enterprises don't want to build.

A standalone, multi-tenant, white-labelable B2B intelligence platform that productizes hybrid RAG, knowledge graphs, entity extraction, document intelligence, contradiction detection, and proactive alerting.

## Status

Active platform development. Horus includes multi-tenant knowledge ingestion and
retrieval, knowledge graphs, agents, API keys, customer portals, AWS/Azure AI
provider paths, and a Marketplace/MCP gateway.

## What's here

- [`AGENTS.md`](./AGENTS.md) — mandatory contribution, verification, review, and deployment rules.
- [`docs/MARKETPLACE-MCP-DESIGN.md`](./docs/MARKETPLACE-MCP-DESIGN.md) — complete design and implementation guide for Marketplace, shared indexes, MCP, auth, isolation, deployment, and UI testing.
- [`docs/CUSTOMER-PORTAL-MAP.md`](./docs/CUSTOMER-PORTAL-MAP.md) — customer portal structure and contracts.
- [`docs/AWS-MIGRATION.md`](./docs/AWS-MIGRATION.md) — current AWS runtime and migration notes.
- `apps/web` — Next.js application and HTTP APIs.
- `packages/core` — inference, agent, knowledge, graph, Marketplace, and MCP runtimes.
- `packages/api` — typed tRPC API.
- `packages/db` — Prisma schema, migrations, and tenant-scoped database client.
- `packages/sdk` — external TypeScript SDK.

## Stack

- Next.js 15 (App Router)
- tRPC v11 (with `@horus/sdk` as the type-safe client export)
- Prisma → Supabase Postgres
- Supabase Auth + custom API key system
- AWS Bedrock/S3 Vectors/S3 or Azure AI/Azure AI Search/Azure Blob
- Multi-tenancy via row-level isolation + per-tenant white-label config
- Model Context Protocol (Streamable HTTP) gateway and Marketplace
