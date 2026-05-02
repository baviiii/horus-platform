# Horus Platform — Roadmap

A living phase tracker. Anchored to `PLAN.md` (the source-of-truth design doc).
Update statuses inline as work lands. Each phase ends with a verification gate
before moving on.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Foundation (week 0)

Goal: a green CI pipeline against an empty-but-valid product skeleton.

- [x] Standalone repo at `horus-platform/` with pnpm + Turborepo workspace
- [x] `PLAN.md` covering vision, architecture, tenancy, white-label, SDK, pricing
- [x] `tsconfig.base.json` with strict + ES2022 + bundler resolution
- [x] Prisma schema (16 models, multi-tenant, pgvector, audit log)
- [x] RLS migration with `current_tenant_id()` session var
- [x] `@horus/auth` (API keys, scopes, supabase helpers)
- [x] `@horus/tenancy` (resolver + edge middleware)
- [x] `@horus/api` tRPC v11 router skeleton (every domain present, stubs throw)
- [x] `@horus/sdk` thin tRPC client + React bindings
- [x] `apps/web` Next.js 15 App Router scaffold
  - [x] tRPC server caller, client provider, route handler
  - [x] `_t/[tenant]` route group with white-label CSS var injection
  - [x] `admin` platform-admin gate
  - [x] Auth callback + magic-link login
- [x] Workers stub directory
- [x] `infrastructure/` moved over (Bicep + scripts)
- [x] `seed-corpus/` moved over
- [x] `.env.example` exhaustive
- [x] GitHub Actions CI: format / typecheck / lint / build / prisma validate / test
- [x] Husky pre-commit + lint-staged
- [ ] `pnpm install` clean on a fresh checkout
- [ ] CI green on first push

**Gate**: `pnpm typecheck && pnpm build` passes locally with empty env.

---

## Phase 1 — Tenant onboarding & auth (week 1)

Goal: a real customer can sign up, get a tenant + subdomain, invite a teammate,
and mint an API key.

- [ ] Supabase project provisioned, env wired
- [ ] First migration applied (`prisma migrate deploy`)
- [ ] Seed `platform` tenant + initial OWNER user
- [ ] `/login` magic link round-trip green
- [ ] Tenant signup flow: create tenant + first OWNER member + Stripe customer
- [ ] Member invite (email via Resend → magic link → role assignment)
- [ ] API key UI (`/_t/[tenant]/settings/keys`) — create/revoke/copy-once
- [ ] `tenant.updateBranding` mutation wired with hex/logo upload
- [ ] Audit log entries for: signup, invite, key.create, key.revoke
- [ ] E2E test: signup → invite → key → SDK call returns 200

**Gate**: a stranger can self-serve onboard end-to-end without a dev unblocking them.

---

## Phase 2 — Document ingest & RAG (week 2)

Goal: tenant uploads a PDF, gets searchable chunks + a working chat.

- [ ] Worker: `pdf-renderer` (Container Apps Job) — port from `azure-functions/pdf-renderer/`
- [ ] Worker: `ingest` queue consumer — port `rag-metadata` logic
- [ ] `documents.upload` tRPC mutation: SAS URL → blob → enqueue
- [ ] `documents.list/get/delete` wired against real Prisma rows
- [ ] Azure Search index provisioned per tenant (or filtered by tenantId)
- [ ] `rag.search` returns hybrid (vector + keyword) results, tenant-filtered
- [ ] `rag.chat` streams answers with citations
- [ ] Chat session/message persistence (`ChatSession`, `ChatMessage`)
- [ ] UsageRecord rows for `RAG_QUERIES`, `INGEST_PAGES`, `EMBEDDING_TOKENS`

**Gate**: upload → 200 pages indexed in <5 min → chat answers cite the doc.

---

## Phase 3 — Knowledge graph & agentic (week 3)

- [ ] Cosmos Gremlin graph provisioned, tenant-partitioned
- [ ] Worker: `entity-extraction` (port from `azure-functions/entity-extraction/`)
- [ ] Worker: `graph-builder` writes Entity + Relationship + Cosmos vertices
- [ ] `graph.entities/relationships/path` real implementations
- [ ] `agentic.plan` (port `agentic-planner`) returns structured plan
- [ ] `agentic.execute` runs plan with tool-calling, streams progress
- [ ] `agentic.intersection` (port `intersection-reasoning`) cross-doc reasoning

**Gate**: agentic query traverses graph + RAG + returns multi-hop answer w/ citations.

---

## Phase 4 — Alerts & intelligence (week 4)

- [ ] Worker: `scraper` for tenant-configured sources
- [ ] Worker: `proactive-alerts` (port `proactive-impact-alerts`)
- [ ] Webhook delivery with HMAC signature + retry
- [ ] `alerts.list/acknowledge` real
- [ ] In-app + email digest channels via Resend
- [ ] Alert rules UI (`/_t/[tenant]/alerts/rules`)

**Gate**: a new doc that matches a rule fires a webhook within 60s.

---

## Phase 5 — Billing & metering (week 5)

- [ ] Stripe customer per tenant on signup
- [ ] Subscription create/update/cancel via Stripe Portal
- [ ] Webhook handler: `customer.subscription.*`, `invoice.*`, `checkout.session.completed`
- [ ] Metered usage reports nightly cron → Stripe usage records
- [ ] Plan-gated limits enforced in tRPC middleware (rate limit + feature flag)
- [ ] `/_t/[tenant]/settings/billing` portal link + invoice list

**Gate**: a tenant upgrading from FREE → PRO via Stripe Portal sees feature gates lift in real time.

---

## Phase 6 — White-label & custom domains (week 6)

- [ ] Custom domain CNAME flow: tenant adds domain → DNS check → cert provisioned
- [ ] Per-tenant logo upload to blob, served via signed URL
- [ ] Theme builder UI (primary color picker → live preview)
- [ ] Email template per-tenant override (Resend templates with tenant vars)
- [ ] `apps/web/middleware.ts` resolves custom domain → tenant

**Gate**: client points `intel.acme.com` at us, sees fully branded experience, no Horus mention.

---

## Phase 7 — SDK GA (week 7)

- [ ] `@horus/sdk` v1.0 published to npm (private registry first)
- [ ] Type-safe client autogenerated from `AppRouter`
- [ ] Streaming helpers for chat
- [ ] `examples/` directory with Next.js, Node, and React snippets
- [ ] Docs site (`apps/docs`?) — at minimum a markdown reference

**Gate**: an external dev integrates Horus chat into their app in <30 min using only public docs + SDK.

---

## Phase 8 — Production hardening (week 8)

- [ ] Sentry wired (web + workers)
- [ ] Axiom log shipping
- [ ] Synthetic monitoring (Checkly or built-in)
- [ ] Load test: 50 concurrent tenants, 10 RPS each, p95 < 800ms for RAG
- [ ] Backup/restore drill: nuke Postgres, restore from PITR, verify tenants intact
- [ ] Penetration smoke test (cross-tenant data access attempts must 403)
- [ ] SOC 2 readiness checklist (access logs, MFA, encryption-at-rest verified)
- [ ] Public marketing site live at `horus.ai`

**Gate**: first paying enterprise tenant can be onboarded without engineering involvement.

---

## Open / parking lot

- Self-hosted on-prem option (Docker Compose bundle)
- Vertical packs: `@horus/module-policy`, `@horus/module-careers` (carry-overs from CareerCraft)
- Multi-region (EU residency)
- Fine-grained RBAC beyond OWNER/ADMIN/MEMBER/VIEWER
- BYO-OpenAI key per tenant (cost-shifting)
- Slack / Teams native bots

---

## Status snapshot — 2026-05-01

Phase 0 ~95% complete. Remaining: first install + first CI run. Phase 1 unblocked
once Supabase project exists and migration applies cleanly.
