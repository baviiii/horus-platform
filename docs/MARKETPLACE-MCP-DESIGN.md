# Horus Marketplace, MCP Gateway, and Index Sharing

> Design and implementation guide
>
> Last updated: 2026-11-21
>
> Status: implemented locally; database migration and production deployment are separate release steps.

This document explains what the Marketplace feature does, why it is designed this way,
where the code lives, and how to operate it safely. It is intended to be the first file to
read before changing Marketplace, MCP, shared-index, or external-access behavior.

## 1. Product goal

Horus previously had the pieces of a marketplace, but they were separate:

- tenant knowledge indexes and entity graphs;
- a TypeScript SDK and API keys;
- tenant-configured MCP clients;
- the separate Interview Coach MCP server;
- workspace agents that could use knowledge and tools.

The Marketplace connects those pieces into one product.

A Horus user can now:

1. Browse published Knowledge Indexes and MCP servers.
2. Attach a listing to a signed-in Horus workspace.
3. Let that workspace's Chat and SDK agent use installed indexes or tools.
4. Connect Cursor, Claude Desktop, Windsurf, or another backend over MCP.
5. Use the same capability through REST v1 or `@horus/sdk`.
6. Publish a workspace Knowledge Collection or MCP connection as a public or
   unlisted listing.

The central security rule is:

> A listing may expose only what its publisher explicitly selected, and a caller may
> perform only what its API-key scope or signed-in role explicitly allows.

## 2. User-facing surfaces

### Public Marketplace

| URL                          | Purpose                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `/marketplace`               | Searchable public catalog of published indexes and MCP servers.                   |
| `/marketplace/[slug]`        | Listing details, exposed tools, metrics, live explorer, and integration snippets. |
| `/api/v1/marketplace`        | Public machine-readable registry.                                                 |
| `/api/v1/marketplace/[slug]` | Machine-readable listing details.                                                 |

The homepage, marketing navigation, footer, and documentation link to the Marketplace.

### Signed-in workspace

| URL                       | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `/t/[tenant]/marketplace` | Install listings, mint scoped keys, generate snippets, and publish listings. |
| `/t/[tenant]/connections` | Configure tenant-owned external MCP servers.                                 |
| `/t/[tenant]/settings`    | View and revoke workspace API keys.                                          |

### External protocols

| Endpoint                           | Protocol                                             |
| ---------------------------------- | ---------------------------------------------------- |
| `/api/mcp/[slug]`                  | Model Context Protocol, Streamable HTTP, stateless.  |
| `/api/v1/marketplace/[slug]/query` | JSON REST API.                                       |
| `marketplace.query`                | Typed tRPC procedure available through `@horus/sdk`. |

Special slug:

- `/api/mcp/workspace` exposes the API key owner's own workspace index.
- `/api/mcp/workspace?collection=<collection-slug>` restricts access to one
  Knowledge Collection.

## 3. Domain model

### `MarketplaceListing`

A listing describes something another workspace or external platform can consume.

Important fields:

- `slug`: global public identifier used in URLs.
- `kind`: `INDEX` or `MCP`.
- `status`: `DRAFT`, `PUBLISHED`, or `ARCHIVED`.
- `visibility`: `PUBLIC` or `UNLISTED`.
- `publisherTenantId`: workspace that owns the listing.
- `collectionId`: optional Knowledge Collection for an index listing.
- `connectionId` or `upstreamEndpoint`: backend for an MCP listing.
- `minPlan`: minimum caller plan.
- `verified` and `featured`: platform-curated presentation flags.

An `INDEX` listing with `collectionId = null` intentionally means the publisher's full
workspace index. A listing that originally referenced a collection must never silently
become full-workspace access. The database relation therefore uses `onDelete: Restrict`,
and the Knowledge router refuses to delete a collection while a non-archived listing
references it.

### `MarketplaceInstall`

An install joins:

- the consuming `tenantId`;
- a `listingSlug`;
- an `enabled` flag;
- the user who installed it.

An enabled install changes the workspace agent:

- installed MCP listings become callable tools when the caller has MCP permission;
- installed Index listings become additional searchable knowledge tools.

Installing does not copy publisher data into the consuming tenant. Retrieval remains
read-only against the publisher's explicitly published target.

## 4. Runtime architecture

```text
Cursor / Claude / backend / Horus UI
                    |
                    | Horus API key or signed-in session
                    v
        MCP route / REST route / tRPC
                    |
          authentication + scopes
          role checks + plan checks
          rate limiting + usage meter
                    |
          resolveMarketplaceTarget()
             /                 \
       INDEX target          MCP target
           |                    |
   search / answer / graph   upstream MCP server
           |                    |
     citations returned     text tool result
```

### Catalog resolution

`packages/core/src/marketplace/catalog.ts` is the source of truth for turning a slug
into an executable target.

It handles:

- built-in first-party listings;
- database-published tenant listings;
- the special caller-owned `workspace` listing;
- plan requirements;
- collection-to-document/source scoping;
- installed workspace attachments;
- safe MCP endpoint and secret resolution.

### Index execution

`packages/core/src/marketplace/execute.ts` implements:

- `search_index`: embeds a query and retrieves ranked passages;
- `ask_index`: generates an answer constrained to retrieved passages;
- `graph_lookup`: resolves an entity and traverses its relationships;
- `list_categories`: returns filterable corpus categories;
- usage recording against the consuming tenant and API key.

Answers use numbered citations. The answer model is instructed to use only supplied
passages and report when the corpus does not support an answer.

### MCP server and gateway

`packages/core/src/mcp/server.ts` uses the official
`@modelcontextprotocol/sdk` Web Standards transport.

Design choices:

- **Stateless transport:** every HTTP request gets a fresh transport. This works with
  Vercel and Lambda and avoids in-memory session affinity.
- **Streamable HTTP:** standard MCP clients receive SSE; lightweight JSON-RPC callers
  can request JSON.
- **Gateway model:** Horus authenticates and meters the caller, then calls the upstream
  MCP without exposing its credentials.
- **Shared execution:** MCP, REST, tRPC, and in-product agents use the same Marketplace
  resolver and execution functions.

## 5. Authentication and authorization

### API keys

Keys are generated as `horus_sk_live_...`, stored only as bcrypt hashes, and resolved
to one tenant.

Marketplace-related scopes:

| Scope               | Meaning                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `marketplace:read`  | Browse/query published Marketplace indexes and inspect listings.          |
| `marketplace:write` | Install or uninstall listings through tenant-scoped APIs.                 |
| `mcp:call`          | Execute MCP tools.                                                        |
| `rag:read`          | Query the key owner's own workspace knowledge.                            |
| `connections:read`  | Allow SDK Chat to attach the tenant's private configured MCP connections. |

Important boundaries:

- `rag:read` does not grant access to other publishers' Marketplace indexes.
- `marketplace:read` does not grant MCP tool execution.
- SDK Chat attaches tenant connections only when the key has both `mcp:call` and
  `connections:read`.
- Installed Marketplace MCP tools attach only when the key has `mcp:call`.
- Publishing, changing status, and deleting listings require an actual signed-in
  OWNER or ADMIN. API keys cannot perform those operations.

### Signed-in users

- OWNER and ADMIN: install, publish, manage listings, mint keys, and execute MCP.
- MEMBER: install and consume according to route permissions.
- VIEWER: browse and query read-only indexes, but cannot execute MCP tools.

Cookie-authenticated mutations require same-origin requests. Wildcard CORS is returned
only for public discovery or API-key-authenticated requests.

## 6. Tenant and collection isolation

Isolation is enforced in layers:

1. API keys resolve to one consuming tenant.
2. Signed-in users must have a `TenantMember` row.
3. Marketplace installs carry `tenantId`.
4. Marketplace listings identify the publisher tenant.
5. Collection listings resolve only document IDs and search source IDs belonging to
   that collection.
6. An empty collection receives the sentinel source ID `__no_documents__`; it never
   falls back to the full index.
7. Graph queries on a collection listing require entities and documents from that
   collection.
8. Postgres RLS protects listing drafts and tenant installs.

### RLS behavior

- `marketplace_installs`: only the current tenant.
- `marketplace_listings`:
  - everyone may read `PUBLISHED` rows;
  - the publisher may read its own drafts/archives;
  - only the publisher tenant may write its rows.

Application authorization remains necessary even with RLS. RLS is the final
defense-in-depth layer, not a replacement for route checks.

## 7. MCP endpoint and secret safety

Tenant-configured MCP endpoints are outbound server requests, so they are treated as
untrusted.

Rules:

- production endpoints must use HTTPS;
- localhost, private, link-local, metadata, multicast, and reserved IP literals are
  blocked;
- bare/internal hostnames are blocked;
- tenant secret references must match `MCP_SECRET_[A-Z0-9_]+`;
- arbitrary names such as `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are rejected;
- the same checks run when adding, testing, displaying, attaching, publishing, and
  resolving a tenant MCP connection;
- upstream endpoint URLs and bearer secrets are never returned in public API responses.

Intentional limitation:

The current URL guard checks the hostname and IP literals but does not pin DNS
resolution. A hostile public hostname could theoretically change DNS to a private
address between validation and connection. Before allowing untrusted community MCP
publishers at large scale, add egress proxying or DNS resolve-and-pin enforcement.

Private-network MCP support is deliberately not enabled for tenant-controlled URLs.
If needed later, implement it through a managed connector with an allowlist rather
than arbitrary Horus-server egress.

## 8. Rate limiting and metering

Marketplace HTTP authentication applies the API key's requests-per-minute limit.
The current limiter is process-local, so horizontally scaled instances do not share a
global counter.

Usage records are written against the consuming tenant:

- `RAG_QUERIES`;
- `GRAPH_QUERIES`;
- `AGENTIC_QUERIES`;
- completion input/output tokens.

For production abuse protection at scale, replace the process-local limiter with a
shared Redis/Upstash implementation while retaining the same API.

## 9. Built-in listings

The catalog includes first-party entries even before custom Marketplace tables are
populated:

1. **Australian Policy, Budget & Workforce Index**
   - defaults to tenant slug `careercraft`;
   - override with `HORUS_DEFAULT_INDEX_TENANT`.
2. **Interview Coach & Role Research MCP**
   - upstream URL from `HORUS_INTERVIEW_COACH_MCP_URL`;
   - optional bearer secret from `HORUS_INTERVIEW_COACH_MCP_SECRET`;
   - can fall back to the `interview_coach` entry in `PLAYGROUND_MCP_SERVERS`.
3. **Workspace Knowledge & Graph Bridge**
   - dynamically resolves to the caller's API-key tenant;
   - optionally scoped with `?collection=<slug>`.

Built-in catalog metadata contains descriptive fallback counts/tool names for the
public page when a backing service is not reachable. The `live` flag indicates whether
the deployment has resolved a live target.

## 10. Environment variables

| Variable                           | Purpose                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `HORUS_INTERVIEW_COACH_MCP_URL`    | Streamable-HTTP endpoint for the first-party coach.                          |
| `HORUS_INTERVIEW_COACH_MCP_SECRET` | Optional first-party bearer secret.                                          |
| `HORUS_DEFAULT_INDEX_TENANT`       | Tenant slug backing the policy/workforce index. Defaults to `careercraft`.   |
| `MCP_SECRET_*`                     | Allowlisted tenant MCP bearer secrets.                                       |
| `PLAYGROUND_MCP_SERVERS`           | Existing operator-managed playground MCP JSON; coach can be discovered here. |

Do not put actual secret values in this repository, documentation, Terraform commits,
or chat transcripts.

## 11. Database and deployment order

The application intentionally degrades to built-in catalog entries if custom
Marketplace tables do not exist, but publishing and installs require the schema.
The idempotent `20261117000000_marketplace_tables` migration supports both a fresh
`prisma migrate deploy` and databases where `prisma db push` already created the
tables.

Release order:

1. Review the code and security diff.
2. Run all repository checks.
3. Apply Prisma schema changes:

   ```bash
   pnpm db:push
   ```

4. Apply Marketplace RLS:

   ```bash
   cd packages/db
   pnpm exec tsx scripts/apply-marketplace-rls.ts
   ```

5. Verify the database role does not have unexpected `BYPASSRLS`.
6. Configure production environment variables.
7. Deploy the web application.
8. Smoke-test public catalog, authenticated workspace access, MCP initialization,
   scoped index search, and revocation.

The schema uses `onDelete: Restrict` for a listing's backing collection. If Prisma
reports an existing foreign-key difference, `db push` must update that constraint
before the app deployment.

## 12. Code map

### Database and auth

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20261117000000_marketplace_tables/migration.sql`
- `packages/db/prisma/migrations/20261118000000_marketplace_rls/migration.sql`
- `packages/db/scripts/apply-marketplace-rls.ts`
- `packages/auth/src/scopes.ts`

### Core runtime

- `packages/core/src/marketplace/catalog.ts`
- `packages/core/src/marketplace/execute.ts`
- `packages/core/src/marketplace/index.ts`
- `packages/core/src/mcp/server.ts`
- `packages/core/src/mcp/client.ts`
- `packages/core/src/agent/run.ts`
- `packages/core/src/agent/run-ai-sdk.ts`

### API

- `packages/api/src/routers/marketplace.ts`
- `packages/api/src/routers/connections.ts`
- `packages/api/src/routers/knowledge.ts`
- `apps/web/src/app/api/mcp/[slug]/route.ts`
- `apps/web/src/app/api/v1/marketplace/route.ts`
- `apps/web/src/app/api/v1/marketplace/[slug]/route.ts`
- `apps/web/src/app/api/v1/marketplace/[slug]/query/route.ts`
- `apps/web/src/lib/marketplace-http.ts`

### UI

- `apps/web/src/app/marketplace/`
- `apps/web/src/app/t/[tenant]/marketplace/`
- `apps/web/src/components/marketplace/`
- `apps/web/src/app/page.tsx`
- `apps/web/src/components/horus/index.tsx`

### Tests

- `packages/auth/test/scopes.test.mjs`
- `packages/core/test/marketplace-mcp.test.mjs`

## 13. Common request flows

### Cursor connects to a published index

1. Workspace admin mints a scoped Marketplace key.
2. Cursor is configured with `https://<horus>/api/mcp/<listing-slug>`.
3. Cursor sends the key in `Authorization: Bearer ...`.
4. Horus validates the key, scope, tenant, plan, and rate limit.
5. Horus resolves the published target.
6. MCP `tools/list` returns the index tools.
7. `tools/call` runs search/answer/graph and records usage.

### Horus Chat uses an installed MCP

1. A non-viewer installs an MCP listing.
2. The workspace agent route resolves enabled installs.
3. The route attaches MCP tools only for a caller allowed to execute MCP.
4. The model requests a tool.
5. Horus calls the upstream and feeds its text result back to the model.

### Publisher deletes a Knowledge Collection

1. The Knowledge router checks for non-archived Marketplace listings.
2. If any listing references the collection, deletion returns `CONFLICT`.
3. The publisher archives or deletes the listing.
4. The collection may then be deleted.
5. The database foreign key also uses `Restrict` as a final safeguard.

## 14. What to test in the UI

After deployment:

1. Open `/marketplace`.
   - Filter Index and MCP listings.
   - Open each built-in listing.
2. Open `/marketplace/careercraft-index`.
   - Sign in and run Search, Ask, and Graph.
   - Confirm citations link to source documents.
3. Open `/t/<workspace>/marketplace`.
   - Enable a listing.
   - Mint an external key.
   - Copy the Cursor/Claude MCP configuration.
4. Add the config to an MCP client.
   - Confirm `tools/list`.
   - Call `list_categories`.
   - Call `search_index`.
5. Create a small Knowledge Collection and publish it.
   - Confirm its public/unlisted page.
   - Confirm searches cannot see documents outside the collection.
   - Confirm the collection cannot be deleted until the listing is removed.
6. Sign in as a VIEWER.
   - Confirm index queries work.
   - Confirm MCP tool calls are rejected.
7. Revoke the API key in Settings.
   - Confirm external calls immediately return `401`.

## 15. Known limitations and future work

- Shared rate limiting is not yet distributed across instances.
- DNS resolution is not pinned; use an egress proxy before broad community publishing.
- Billing is metered but Marketplace revenue sharing is not implemented.
- Listing moderation/approval is not a workflow; tenant listings publish immediately.
- Built-in listing metadata is code-defined rather than managed through an admin UI.
- OAuth-based MCP authorization is not implemented; Horus API keys are used.
- Automation execution and AWS voice remain separate unfinished platform areas.

## 16. Design principles to preserve

When changing this feature:

1. Never turn a missing scope into broader access.
2. Never turn a missing collection into full-workspace access.
3. Never expose publisher credentials to consumers.
4. Never trust tenant-controlled outbound URLs without egress checks.
5. Keep MCP, REST, SDK, and in-product agent behavior on the same resolver/executor.
6. Meter the consumer, not the publisher.
7. Keep `/api/infer` and model-output contracts unchanged unless downstream products
   are explicitly tested.
8. Prefer explicit errors over silent permission fallbacks.
