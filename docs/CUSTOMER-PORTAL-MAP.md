# Customer Portal — Structure Map

> Date: 2026-08-16 · Scope: everything that was added/changed for the customer-portal feature.

This document is the **single source of truth** for the customer-portal work: where things live, what they do, and how they hang together. If you add a new surface or change a contract, update this file.

---

## 1 · What "customer portal" means here

Two audiences, two surfaces:

| Audience                             | Where                                                | Purpose                                                                                                                |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Tenant staff / admins**            | `/t/[tenant]/*` (existing workspace shell, extended) | Manage knowledge, agents, automations, usage — everything needed to **operate** the tenant's AI offering.              |
| **Tenant's customers** ("end users") | `/t/[tenant]/portal/*`                               | Consume what the tenant published: chat with agents, (later) talk to voice agents, view their own sessions. No ops UI. |

Both surfaces are authenticated the same way today (Supabase user must be a tenant member). Public / unauthenticated access (for true end-user embedding) is a Phase-2 concern — see §11.

---

## 2 · Where things live (file tree)

### Database (`packages/db/prisma/`)

```
packages/db/prisma/
  schema.prisma                  ← extended: KnowledgeCollection, Agent, Automation, +relations
  migrations/
    20260502000000_init_rls/        (existing — RLS bootstrap)
    20260729000000_incidents_rls/   (existing — incident vertical RLS)
    20260816000000_portal_rls/      NEW — RLS for knowledge_collections, agents, automations
  scripts/
    apply-portal-rls.ts             NEW — one-shot runner for the portal RLS SQL
```

### tRPC API (`packages/api/src/routers/`)

```
packages/api/src/routers/
  index.ts          ← registers: knowledge, agents, automations, usage
  knowledge.ts      NEW — KnowledgeCollection CRUD + assignDocument
  agents.ts         NEW — Agent CRUD + status toggle
  automations.ts    NEW — Automation CRUD + setStatus
  usage.ts          NEW — read-only usage aggregation for tenants
  documents.ts      ← requestUpload implemented (SAS-based direct-to-blob)
                    + commitUpload (mark a client-side PUT as done)
                    + accepts collectionId for collection-scoped ingest
```

### Core (`packages/core/src/`)

```
packages/core/src/
  agent/run.ts      ← RunAgentParams extended: `persona?`, `personaName?`
                      (injected as Foundry `additionalInstructions`)
```

### Web app (`apps/web/src/`)

```
apps/web/src/
  app/workspaces/page.tsx       NEW — post-login workspace chooser
  app/api/auth/callback/route.ts ← default `next` is now /workspaces

  app/t/[tenant]/
    layout.tsx                  ← nav regrouped; new "Customer portal" section;
                                  fetches user's memberships → AppShell switcher
    page.tsx                    (existing — overview)
    chat/                       (existing — workspace chat)

    knowledge/                  NEW — collections list + create
      page.tsx
      knowledge-client.tsx

    agents/                     NEW — agent list + create + status toggle
      page.tsx
      agents-client.tsx

    automations/                NEW — automation list + create + toggle
      page.tsx
      automations-client.tsx

    usage/                      NEW — usage dashboard (server-rendered)
      page.tsx

    portal/                     NEW — end-user portal (separate shell)
      layout.tsx                ← minimal chrome, no staff sidebar
      page.tsx                  ← picks an agent, start chat/voice
      chat/
        page.tsx
        portal-chat-client.tsx  ← single-thread chat UI (no session list)
      voice/
        page.tsx                ← placeholder (until voice provider wired)

  app/api/agent/chat/route.ts   ← accepts optional `agent` slug; resolves
                                  collectionIds → sourceIds filter for
                                  retrieval scoping; injects persona
```

---

## 3 · Data model

Three new models, all tenant-scoped with RLS enforced at the DB layer.

### `KnowledgeCollection`

Named silo of documents. Agents bind to collections; documents belong to **zero or one** collection.

```
id, tenantId, name, slug (unique per tenant), description?, category?,
partition? (search partition; defaults to slug), isDefault, createdAt, updatedAt

Relations:  tenant → Tenant, documents → Document[]
Indexes:    @@unique([tenantId, slug]), @@index([tenantId])
```

`Document.collectionId` is a **new nullable FK** — `onDelete: SetNull`, so deleting a collection doesn't cascade-delete documents.

### `Agent`

A chat / voice / hybrid surface. Grounded in 0..n collections (empty = whole workspace).

```
id, tenantId, name, slug (unique per tenant),
kind:        CHAT | VOICE | HYBRID
status:      DRAFT | ACTIVE | PAUSED | ARCHIVED
persona?,                        ← injected as additionalInstructions at run time
collectionIds String[],          ← which collections ground this agent
toolSlugs     String[],          ← which MCP connection slugs it may call
voiceConfig   Json,              ← { voice, language, providerRef, ... }
embedConfig   Json,              ← { greeting, theme, allowedOrigins, ... }
createdById, createdAt, updatedAt
```

### `Automation`

Trigger → action rule. **Phase 1 = registry + on/off.** Execution is the responsibility of a future worker that polls ACTIVE automations.

```
id, tenantId, name, description?,
trigger:       DOCUMENT_INDEXED | CHAT_SESSION_ENDED | SCHEDULE | WEBHOOK
status:        DRAFT | ACTIVE | PAUSED
triggerConfig  Json,        ← trigger-specific (cron, category, agentId, webhookSecretRef…)
action         Json,        ← { kind: 'webhook'|'alert'|'email'|'infer', config: {...} }
lastRunAt, lastError, runCount, createdAt, updatedAt
```

### RLS

All three tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` using `current_tenant_id()`. Same posture as incidents/alerts.

---

## 4 · API surface (tRPC)

All procedures are `scopedProcedure(...)` — they require the scope listed, on the tenant the request is authenticated against.

| Router        | Procedure                                    | Scope             | Notes                                             |
| ------------- | -------------------------------------------- | ----------------- | ------------------------------------------------- |
| `knowledge`   | `list` / `get`                               | `documents:read`  |                                                   |
|               | `create` / `update` / `delete`               | `documents:write` | `delete` clears `Document.collectionId`           |
|               | `assignDocument`                             | `documents:write` | Set or clear a doc's collection                   |
| `agents`      | `list` / `get`                               | `documents:read`  |                                                   |
|               | `create` / `update` / `delete`               | `documents:write` | `create` validates collectionIds belong to tenant |
| `automations` | `list` / `get`                               | `documents:read`  |                                                   |
|               | `create` / `update` / `setStatus` / `delete` | `documents:write` |                                                   |
| `usage`       | `summary` / `recent`                         | `documents:read`  | Read-only aggregates over `usage_records`         |
| `documents`   | `requestUpload`                              | `documents:write` | Returns a 15-min SAS URL for direct-to-blob PUT   |
|               | `commitUpload`                               | `documents:write` | Marks PENDING → PROCESSING after client PUT       |

**Why these scopes?** Agents/collections/automations all gate on the _documents_ resource because they all operate on the tenant's knowledge. Finer-grained scopes (`agents:write`, `automations:write`) can come later if a customer needs them — add them to `packages/auth/src/scopes.ts` and swap the procedure guard.

---

## 5 · HTTP routes

| Route                        | Change                                  | Why                                                                                        |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/agent/chat`       | accepts optional `agent: string` (slug) | Portal chat + any agent-scoped conversation                                                |
| `GET /api/agent/chat`        | unchanged                               | Used by both workspace and portal chat                                                     |
| `POST /api/documents/upload` | unchanged                               | Existing server-streamed PDF upload (still the default; SAS flow is for SDK/API consumers) |

**Agent scoping semantics in `/api/agent/chat`:**

- No `agent` → behaves exactly as before (workspace partition, no persona, no sourceId filter).
- `agent` provided → looks up the agent, 404s if not `ACTIVE`.
- Partition is always `workspace` (one shared index); **collection scoping is done via `sourceIds` filter** at query time.
- If the agent has `collectionIds`, the route resolves them to document `sourceIds` via Prisma, then passes them to `runKnowledgeAgent` → `ToolScope` → `searchKnowledge` as an OData `sourceId eq ...` filter. Empty collections → `sourceIds = ['__no_documents__']` so retrieval returns zero hits (honest, not an error).
- Persona is prepended to Foundry's `additionalInstructions` (not a system message — Foundry's agent already carries its own system prompt).
- Session `context` = `agent:<slug>` (vs `workspace-agent`), so session history is naturally separated per agent.

---

## 6 · UI surfaces

### Staff portal (`/t/[tenant]/…`)

| Page        | Server file            | Client file                          | Notes                                                                 |
| ----------- | ---------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| Knowledge   | `knowledge/page.tsx`   | `knowledge/knowledge-client.tsx`     | Stats row (collections, docs, ungrouped, chunks) + create/list/delete |
| Agents      | `agents/page.tsx`      | `agents/agents-client.tsx`           | Stats + create/list/activate/pause/delete; collection chips           |
| Automations | `automations/page.tsx` | `automations/automations-client.tsx` | Stats + create/list/toggle/delete                                     |
| Usage       | `usage/page.tsx`       | — (server-only)                      | Meters 30d, snapshot, recent activity                                 |

The tenant layout (`layout.tsx`) is regrouped into four sections:

- **(untitled top)** — Overview, Chat
- **Customer portal** — Knowledge, Agents, Automations, Usage, End-user portal
- **Intelligence** — Documents, Intelligence, Knowledge graph, Incidents, Connections, Alerts
- **Workspace** — Settings, Members, API keys, Billing

### End-user portal (`/t/[tenant]/portal/…`)

Completely separate shell (no staff sidebar). Today it's gated to tenant members; making it public is Phase 2.

| Route                                   | Purpose                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `/t/[tenant]/portal`                    | Pick an agent, see persona, jump to chat / voice                                     |
| `/t/[tenant]/portal/chat?agent=<slug>`  | Single-thread chat UI; auto-creates a `ChatSession` with `context=agent:<slug>`      |
| `/t/[tenant]/portal/voice?agent=<slug>` | Placeholder — switches on when `voiceConfig.providerRef` points to a live connection |

---

## 7 · Permissions & RLS

- All portal tables share the platform-wide RLS pattern (`tenant_isolation` policy).
- All tRPC procedures in the new routers go through the tenant-scoped Prisma client (`ctx.db`), so `app.tenant_id` is set per request and the DB enforces isolation even if application code is wrong.
- UI uses `requireTenantMember(slug)` (server) for page gating and `trpc` (client) for mutations — same guarantee, two layers.

---

## 8 · Azure / infra dependencies

| Piece                     | Depends on                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `documents.requestUpload` | `AZURE_STORAGE_CONNECTION_STRING` (returns 412 if unset)                                                    |
| Agent runtime (chat)      | `AZURE_OPENAI_*` (existing) + Foundry agent provisioned lazily by `runKnowledgeAgent`                       |
| Knowledge search          | `AZURE_SEARCH_INDEX_NAME` (or `AZURE_SEARCH_PLAYGROUND_INDEX`)                                              |
| Voice (future)            | Voice provider connection (LiveKit / Vapi / Azure Voice Live) referenced in `Agent.voiceConfig.providerRef` |

No new Azure resources were introduced by this change.

---

## 9 · How to exercise the new surface

```bash
# 1. Apply schema (already done for this repo, kept for the record)
pnpm db:generate
cd packages/db && pnpm exec prisma db push

# 2. Apply RLS
cd packages/db && pnpm exec tsx scripts/apply-portal-rls.ts

# 3. Run the app
pnpm web:dev

# 4. Sign in, navigate to a tenant, then:
#    /t/<slug>/knowledge     → create a collection
#    /t/<slug>/documents     → upload a PDF (collection optional)
#    /t/<slug>/agents        → create an agent, bind collections, Activate
#    /t/<slug>/portal        → see the agent, click Chat
#    /t/<slug>/automations   → create a DOCUMENT_INDEXED → alert rule, Activate
#    /t/<slug>/usage         → see usage (empty until first chat / upload)
```

---

## 10 · What's intentionally NOT done

- **Automation execution worker** — automations are registry-only; nothing polls them yet.
- **Voice runtime** — the `voice` portal page is a stub; no WebRTC, no provider SDK.
- **Public / unauthenticated end-user portal** — currently the portal requires tenant membership. Public access needs a separate "portal user" model (or signed embed tokens) and a routing decision (subdomain vs path).
- **Per-collection retrieval filtering** — **now implemented.** Agents with `collectionIds` resolve them to document `sourceIds` and pass them to `searchKnowledge` as an OData `sourceId eq ...` filter. The upload route (`/api/documents/upload`) and tRPC `documents.requestUpload` both accept `collectionId`. The search index itself is unchanged — filtering happens at query time.
- **Embed snippet** — no public embed URL yet; the "Embed" tab in Agents is descriptive.

---

## 11 · Phase 2 considerations

- **Public portal**: introduce a `PortalUser` (or JWT-issued portal token) distinct from Supabase auth, and decide whether the portal lives at `portal.<tenant>.horus.app` or stays under `/t/<slug>/portal` with a looser guard.
- **Worker for automations**: a small Node worker (`workers/automations/`) polling `automations` where `status=ACTIVE`, dispatching on `trigger`, recording `lastRunAt`/`runCount`/`lastError`.
- **Per-collection partition in Azure AI Search**: add `collectionId` to the indexed fields and filter in `searchKnowledge` so agents actually retrieve only from their bound collections.
- **Voice**: pick a provider (LiveKit or Azure Voice Live are the natural fits given the Foundry commitment) and wire `Agent.voiceConfig` into a real session bootstrap.

---

## 12 · Quick reference — new files added

```
packages/api/src/routers/knowledge.ts
packages/api/src/routers/agents.ts
packages/api/src/routers/automations.ts
packages/api/src/routers/usage.ts
packages/db/scripts/apply-portal-rls.ts
packages/db/prisma/migrations/20260816000000_portal_rls/migration.sql
apps/web/src/app/t/[tenant]/knowledge/page.tsx
apps/web/src/app/t/[tenant]/knowledge/knowledge-client.tsx
apps/web/src/app/t/[tenant]/agents/page.tsx
apps/web/src/app/t/[tenant]/agents/agents-client.tsx
apps/web/src/app/t/[tenant]/automations/page.tsx
apps/web/src/app/t/[tenant]/automations/automations-client.tsx
apps/web/src/app/t/[tenant]/usage/page.tsx
apps/web/src/app/t/[tenant]/portal/layout.tsx
apps/web/src/app/t/[tenant]/portal/page.tsx
apps/web/src/app/t/[tenant]/portal/chat/page.tsx
apps/web/src/app/t/[tenant]/portal/chat/portal-chat-client.tsx
apps/web/src/app/t/[tenant]/portal/voice/page.tsx
```

Files modified:

```
packages/db/prisma/schema.prisma
packages/api/src/routers/index.ts
packages/api/src/routers/documents.ts
packages/api/package.json                (+ @azure/storage-blob dep)
packages/core/src/agent/run.ts           (+ persona, personaName, sourceIds)
packages/core/src/agent/tools.ts         (+ sourceIds in ToolScope, passed to searchKnowledge)
apps/web/src/app/t/[tenant]/layout.tsx   (+ memberships prop to AppShell)
apps/web/src/app/t/[tenant]/page.tsx     (+ "Open end-user portal" action)
apps/web/src/components/app/shell.tsx    (+ TenantMembership, sidebar switcher)
apps/web/src/app/api/auth/callback/route.ts (default next = /workspaces)
apps/web/src/app/api/agent/chat/route.ts (+ agent slug → sourceIds scoping)
```

## 13 · Tenant switching & workspace chooser

**Sidebar switcher** (`AppShell`): the card under the Wordmark shows the active workspace (avatar + name + role). Click it → dropdown lists every tenant the user is a member of, with role badges. Selecting one navigates to `/t/<slug>`.

**`/workspaces` page**: post-login landing when the user has 0 or 2+ memberships. With exactly 1 membership it auto-redirects to `/t/<slug>`. With 0 it redirects to `/onboarding`. With 2+ it lists each workspace with plan, role, member count, document count.

**Auth callback default**: `/api/auth/callback` now redirects to `/workspaces` instead of `/` when no `next` is supplied — so the first thing a multi-tenant user sees after magic-link is the workspace chooser, not the marketing homepage.

The whole thing is navigation-only — RLS still isolates data per tenant at the DB layer; the switcher just changes the URL.
