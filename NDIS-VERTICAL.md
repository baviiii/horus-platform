# NDIS Vertical — Incident Reporting

> Horus's first sellable vertical: compliance-grade incident reporting for
> NDIS / disability providers. Shipped 2026-07-29. This document is the
> feature-by-feature record of what exists, where it lives, and what was
> verified — plus the honest gaps.

**The pitch in one sentence:** a support worker describes an incident once, in
plain language; Horus fills the provider's _own_ incident form with values it
can cite back to the evidence, computes the NDIS Commission's statutory
clocks, routes it through human review and approval, and exports the Word
document the provider actually files — identified for the internal record,
de-identified for boards and insurers.

**Product promises (enforced in code, not marketing):**

1. The AI only fills fields it can cite — every value carries a verbatim quote
   from a named evidence item; gaps go to a missing-required list for a human.
2. Approval is a human act — a signed-in ADMIN/OWNER, never an API key, and
   never with required fields missing.
3. Horus never submits to a regulator. Export is the terminal act.
4. Every state change lands in the incident timeline **and** the audit log.
5. Tenant isolation at the database (RLS), not just the application.

---

## Demo script (for pitching)

```
1. /playground/incidents            — no login needed
2. Click "Unauthorised restraint" sample → "Draft the incident report"
   → watch it classify unauthorised_restrictive_practice, severity HIGH,
     fill the conditional restraint section, start the 5-business-day clock
3. Hover the citation chips — every value traces to the reporter's words
4. Point at the missing-required box — "the AI won't guess"
5. Download the Word doc, then the de-identified copy (names → Participant A)
6. Then the real dashboard: /t/careercraft/incidents
   → templates page: absorb THEIR form (PDF/docx) live
   → new incident → review screen → submit → approve → export
```

Demo is stateless server-side: nothing a visitor types is stored. The banner
says so because it's true — that's the privacy answer in the room.

---

## Features

### 1. Regulatory reference pack (verified, versioned)

`packages/core/src/incidents/reference.ts`

The six reportable-incident categories and their timeframes, verified against
the **NDIS (Incident Management and Reportable Incidents) Rules 2018
(F2018L00633)** fetched from legislation.gov.au on 2026-07-29 — not from model
memory. 24-hour categories (death, serious injury, abuse/neglect, unlawful
contact/assault, sexual misconduct) + 5-business-day detailed report;
unauthorised restrictive practice at 5 business days; 60-business-day final
report noted as on-request. Pack carries `version`, `retrievedAt`, source
URLs, and a `disclaimer` that the UI and every export must (and do) show.
Business-day maths excludes weekends; **public holidays are intentionally not
modelled yet** — the disclaimer says so.

### 2. Template absorption — "we eat their form"

`packages/core/src/incidents/absorb.ts` · `incidents.absorbTemplate` mutation
· `/api/incidents/parse-file`

Upload the provider's existing incident form (PDF / .docx / .txt / .md ≤10MB)
→ text extraction (unpdf / mammoth) → Content Safety screen → gpt-4o (deep
tier, temp 0.1) proposes `{sections, fields}` with types, required flags,
select options, conditional gating, and **PII marking** → zod-validated and
normalized (`normalizeTemplateSchema`: dedupes keys, repairs dangling
sections/conditionals, degrades optionless selects) so a bad model day is a
validation error, never a corrupt template. Provenance (source filename +
excerpt) stored on the row.

### 3. NDIS starter template

`packages/core/src/incidents/starter-template.ts` ·
`incidents.createStarterTemplate`

A realistic 29-field, 7-section NDIS incident form (incident details, people,
description, immediate response, conditional restrictive-practice section,
notifications, follow-up) seeded with one click from the templates page. Also
the fixed form behind the public demo. Providers edit it rather than starting
blank.

### 4. Evidence-cited drafting — the core promise

`packages/core/src/incidents/draft.ts` · `incidents.create` + `incidents.draft`

Narrative + photos + documents become evidence rows; the drafter receives the
template's field spec and the evidence, and returns per-field
`{value, confidence, evidence: [{evidenceId, quote}]}`. Server-side
discipline: unknown fields dropped, values coerced to their declared types,
citations pointing at unknown evidence stripped, **missing-required recomputed
deterministically** (the model's own gap report is never trusted), and values
a human edited (`confidence: "manual"`) are never overwritten by a re-draft.
Token usage metered to `UsageRecord`.

### 5. Statutory deadline engine

`computeDeadlines()` in `reference.ts` — clocks run from when key personnel
became aware (`discoveredAt`, falling back to `occurredAt`, then creation).
Recomputed on every classification/date change. Surfaces: dashboard "Statutory
clocks" panel, nav badge (overdue count), review-screen banner with live
countdown, docx meta block, demo countdown tiles.

### 6. De-identification — one record, two renditions

`packages/core/src/incidents/deid.ts` · `packages/core/src/clients/language.ts`

Three layers: (1) deterministic — PII-marked name fields get role pseudonyms
(`Participant A`, `Staff Member 1`, `Witness 1`, `Person N` — role inferred
from field key/label), other PII fields become `[REDACTED — label]`, and the
pseudonym map scrubs every free-text value including partial-name tokens;
(2) **Azure AI Language PII detection** (same Foundry endpoint + key as
Content Safety — no new resource) sweeps free text for stray names and
identifiers; (3) regex net for emails, AU phone numbers, long digit runs
(NDIS/Medicare numbers). The map persists on the incident (`deidMap`) so
re-exports stay stable. If the Language service is down, export still works
but is stamped "deterministic layers only — review before sharing".

### 7. Photo evidence analysis (the image-analyzer feature)

`packages/core/src/incidents/vision.ts` · `/api/incidents/photo` · demo upload

JPEG/PNG/WebP ≤8MB → **Content Safety image moderation** (added
`moderateImage` to `packages/core/src/safety/content-safety.ts`) → blob
storage under the tenant's private container (optional in dev — degrades to
text-only) → gpt-4o vision with a deliberately conservative prompt (describe,
never diagnose, never identify people; transcribe visible text; list hazards)
→ a citable PHOTO evidence row the drafter can quote like any other evidence.

### 8. .docx export — the actual deliverable

`packages/core/src/incidents/render.ts` (`docx` package) ·
`/api/incidents/export?tenant&id&mode`

Professional Word document: org masthead, mode/status banners (DEMO,
DE-IDENTIFIED, NOT-YET-APPROVED), meta table with both statutory clocks and
their basis, the template's own sections (short fields as label/value tables,
textareas as prose), evidence appendix, approval block (approver email
captured at approve time), and a footer that states the disclaimer and that
Horus never lodges anything. First export of an APPROVED incident advances it
to EXPORTED.

### 9. Review workflow, roles, audit

`packages/api/src/routers/incidents.ts` · `packages/api/src/audit.ts`

`DRAFT → IN_REVIEW → APPROVED → EXPORTED → CLOSED`, with
`changes_requested` bouncing back to DRAFT (note required). VIEWER role is
read-only; approval/review demand a signed-in ADMIN/OWNER; approval is blocked
while required fields are missing; CLOSED is immutable; incidents are never
deletable (compliance records). Every transition writes an `IncidentEvent`
(timeline UI) and an `AuditLog` row (who/IP/user-agent). New API scopes:
`incidents:read` / `incidents:write`.

### 10. Tenant dashboard UI

`apps/web/src/app/t/[tenant]/incidents/**` + nav in the tenant layout

- **/incidents** — stat tiles (open / in review / overdue clocks / this
  month), statutory-clocks panel with countdowns, single-hue category bar
  list, recent-incidents table, honest empty states, pack disclaimer.
- **/incidents/templates** — absorb dropzone, starter-template button, per-
  template field editor (label/type/required/PII/options, add/remove) saving
  as a new version; activate/archive.
- **/incidents/new** — template + category pickers, occurred/aware datetimes,
  narrative, photo/document attachments; one button runs create → attach →
  draft → lands on the review screen.
- **/incidents/[id]** — the review screen: form grouped by the template's own
  sections, per-field confidence dots + citation chips (hover for the quote),
  conditional visibility live, missing-required + deadline banners, evidence
  panel (add note/photo/document), timeline, role-gated action rail, export
  buttons. Nav shows an overdue-clock badge.

### 11. Public playground demo (the pitch surface)

`apps/web/src/app/playground/incidents` + `/api/playground/incidents/*`

No-auth, rate-limited (10 drafts/hr/IP), **stateless** — draft returns JSON,
export takes the draft back and streams a DEMO-watermarked docx; nothing
persisted. Two curated samples (medication error → correctly _not_ reportable,
which shows the model doesn't cry wolf; unauthorised restraint → URP category,
HIGH severity, conditional section filled, 5-business-day clock). Citation
chips, live countdowns, missing-required callout, identified + de-identified
export, link from the main playground header.

### 12. Workspace document upload (Phase-2 gap closed)

`/api/documents/upload` + upload button on `/t/[tenant]/documents`

The playground ingest pipeline (extract → moderate → chunk → embed → index)
pointed at the tenant's permanent partition (`tenantId` + session
`workspace` — exactly what the workspace agent already searches), with a real
`Document` row (PROCESSING → INDEXED/FAILED), blob storage when configured,
`DOCUMENTS_PROCESSED` usage metering, and audit. The RUNBOOK's "workspace
document upload — not built" is no longer true.

### 13. Data model + RLS

`packages/db/prisma/schema.prisma` + migration
`20260729000000_incidents_rls`

Four new tables — `incident_templates`, `incidents`, `incident_evidence`,
`incident_events` — all carrying `tenantId` with the same
`current_tenant_id()` RLS policy as the rest of the schema (applied to the
live dev DB). Human refs `INC-YYYY-NNNN` unique per tenant. Field values,
citations, and the de-ID map live as validated JSON columns documented in the
schema.

### 14. API surface

Everything is on the tRPC router (`incidents.*`), so `@horus/sdk` consumers
get the whole vertical type-safe for free. Multipart/binary flows live as
route handlers: `parse-file`, `photo`, `export`, `documents/upload`,
`playground/incidents/{draft,export}`. tRPC route handler got
`maxDuration = 120` for the long model calls.

---

## Verified (live, 2026-07-29)

- `pnpm typecheck` — 14/14 tasks green; `pnpm --filter @horus/web build` —
  production build green, all routes present.
- Live smoke (real gpt-4o + real Language service): medication-error narrative
  → 18 fields filled, participant name cited verbatim at high confidence,
  zero missing required, title used initials as instructed; de-ID mapped
  "Marcus Tran → Participant A" and left **zero** name leaks across the
  scrubbed narrative; both docx renditions rendered (~11KB).
- Restraint narrative → `unauthorised_restrictive_practice`, severity HIGH,
  conditional section filled (`restrictive_practice_used: true`, type
  "Physical restraint", `authorised: false`), 5-business-day clock computed
  correctly (hand-checked against the calendar).
- Prisma smoke against the live Supabase DB: new tables queryable; RLS script
  executed clean.

Not yet exercised end-to-end in the browser: the full dashboard click-through
(create → approve → export) — the underlying mutations and routes are the
same code paths the smoke tests hit, but do one full pass before the first
client demo.

## Config

No new required env. Optional/nice-to-have:

- `AZURE_STORAGE_CONNECTION_STRING` — evidence/document originals to blob
  (dev degrades to text-only evidence, uploads still work).
- `AZURE_LANGUAGE_ENDPOINT` — only if the Language data plane ever diverges
  from `AZURE_CONTENT_SAFETY_ENDPOINT` (same Foundry account today).

## Honest gaps / next

1. **Data residency** — Foundry + Search live in `eastus2`; Supabase likewise
   non-AU. Australian participant data will fail procurement at serious
   providers. The OpenTofu greenfield should stand up an `australiaeast`
   stack before the first real pilot. (Biggest commercial blocker.)
2. Public holidays not in the business-day maths (disclaimer covers it;
   per-state holiday calendars are the fix).
3. Scanned/image PDFs and forms don't OCR (Azure Document Intelligence is the
   upgrade path — same account family).
4. Photo evidence is analyzed but not _viewable_ in the UI (blob is private;
   needs a signed-URL viewer route).
5. Playground rate limiter is in-memory (single instance); Upstash is the
   production move, interface already matches.
6. No email/webhook nudges when a statutory clock nears — Resend digest is
   the obvious v2.
7. Billing: token usage is metered, not priced.
8. `documents.requestUpload` tRPC stub still throws — superseded by the
   multipart route; either implement as a thin pointer or delete at the next
   API-surface tidy.
9. Legal review before selling: the reference pack is engineering-verified
   against the Rules, not lawyer-verified. Do not market "compliance
   guaranteed" — market "your form, drafted with citations, clocks tracked,
   human-approved."
