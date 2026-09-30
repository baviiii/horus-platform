# Exposing a Horus capability to CareerCraft

A do-it-yourself guide covering:

- how `/api/infer` and `/api/embed` work
- how CareerCraft reaches them
- how to test them by hand
- how to build your own endpoint

Written 2026-09-30. File and line references match the code as of that date.

---

## Contents

0. [What's left on /api/embed (your to-do list)](#0-whats-left-on-apiembed)
1. [The big picture](#1-the-big-picture)
2. [A file becomes a URL](#2-a-file-becomes-a-url)
3. [Step 1: who are you? (API keys)](#3-step-1--who-are-you-api-keys)
4. [Step 2: are you allowed? (scopes)](#4-step-2--are-you-allowed-scopes)
5. [Step 3: is the input sane? (zod)](#5-step-3--is-the-input-sane-zod)
6. [Step 4: do the work, then respond](#6-step-4--do-the-work-then-respond)
7. [The caller side: CareerCraft](#7-the-caller-side--careercraft)
8. [Where secrets live](#8-where-secrets-live)
9. [Test it by hand](#9-test-it-by-hand)
10. [The key-scope check (do this before calling it done)](#10-the-key-scope-check)
11. [Recipe: build your own endpoint](#11-recipe-build-your-own-endpoint)
12. [Practice exercises](#12-practice-exercises)
13. [The same pattern in tRPC](#13-the-same-pattern-in-trpc)
14. [File map](#14-file-map)

---

## 0. What's left on /api/embed

Work through these in order:

- [ ] **Create the small-model deployment.** Run this in your own terminal and type `yes` once it shows `1 to add`:
  ```bash
  tofu -chdir=infrastructure/tofu/envs/dev apply
  ```
- [ ] **Compare small against large on the ranking cases.** Small is good enough if it passes 5/5.
  ```bash
  pnpm exec tsx scripts/verify-embed.ts --compare
  ```
- [ ] **Check which key CareerCraft's embed call uses.** See [§10](#10-the-key-scope-check). If it's the read-only key, every call silently fails with a 403.
- [ ] **Deploy Horus to Vercel.** No new environment variables are needed.
- [ ] **Do one real search in CareerCraft, then read the edge-function logs.**
  - `[similarity] N items, min=… median=… max=…` means it's working.
  - `[similarity] unavailable … HTTP 403` means it's the key problem in §10.
- [x] **Committed (2026-09-30).** The embed endpoint and the deactivated-tenant fix went in as two commits. The
      budget router is still uncommitted on purpose: the pre-publish review found problems to fix first.
- [ ] **Rotate `AZURE_AU_OPENAI_API_KEY`.** It was printed into a session log.
  1. Regenerate key 2 in Azure.
  2. Switch `.env.local` and Vercel to key 2.
  3. Regenerate key 1.

---

## 1. The big picture

Horus and CareerCraft are two separate apps. They talk over plain HTTPS: Horus exposes URLs, and CareerCraft calls them with a secret key.

```
CareerCraft edge function                     Horus (Vercel)
───────────────────────────                   ──────────────────────────────────
fetch(HORUS_BASE_URL + "/api/embed",    ──►   apps/web/src/app/api/embed/route.ts
  Authorization: Bearer horus_sk_…)             1  who are you?       → 401
                                                2  are you allowed?   → 403
                                                3  is the input sane? → 400
                                                4  do the work        → 502 if it fails
                                                   record usage
                                        ◄──   200  { vectors, count, model, dimensions, tokens }
```

Every endpoint Horus exposes to another app follows these same four steps. Learn them once and every route in `apps/web/src/app/api/` reads the same way.

---

## 2. A file becomes a URL

Horus's web app uses the **Next.js App Router**. The folder path under `app/` _is_ the URL:

```
apps/web/src/app/api/embed/route.ts   →   https://<horus>/api/embed
apps/web/src/app/api/infer/route.ts   →   https://<horus>/api/infer
apps/web/src/app/api/health/route.ts  →   https://<horus>/api/health
```

Inside `route.ts`, the name of each exported function says which HTTP method it handles:

```ts
export async function POST(req: Request) { … }   // handles POST /api/embed
export async function GET(req: Request)  { … }   // would handle GET /api/embed
```

Two more lines at the top of the route matter:

```ts
export const runtime = 'nodejs'; // bcrypt (used to check keys) needs Node, not the Edge runtime
export const dynamic = 'force-dynamic'; // never cache: every request is different
```

**Nothing in front of the route protects it.** `apps/web/src/middleware.ts` runs on every request, but it only
refreshes the Supabase login cookie. It never blocks anything. So **each route must guard itself**, and that's what
steps 1–3 below do. If you forget them, the endpoint is open to the whole internet.

---

## 3. Step 1: who are you? (API keys)

```ts
// apps/web/src/app/api/embed/route.ts : 63–80
function readKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) return auth.replace(/^Bearer\s+/i, '').trim(); // "Authorization: Bearer horus_sk_…"
  const fn = req.headers.get('x-functions-key');
  return fn ? fn.trim() : null; // Azure-style header, also accepted
}

const token = readKey(req);
if (!token) return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
const auth = await validateApiKey(token); // → { apiKey, tenantId, scopes } or null
if (!auth) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
```

### How keys are made

From `packages/auth/src/api-keys.ts : 22`:

1. Generate 24 random bytes and encode them as text. That's the secret part.
2. Add the prefix `horus_sk_live_` (or `horus_sk_test_`). This gives the full key, e.g. `horus_sk_live_wwSOIu…`.
3. Store only a **bcrypt hash** of the full key, plus the **public prefix** (the first 20 characters).
4. Show the full key to the person **exactly once**.

After that, not even Horus can recover it. If you lose a key, you make a new one.

You create keys in the Horus UI: **`/t/<tenant>/settings` → API keys**. That runs `createApiKeyAction` (`apps/web/src/app/t/[tenant]/settings/actions.ts : 27`). Keys made there get `DEFAULT_SCOPES` (line 8), which includes `intelligence:infer`.

### How keys are checked

From `validateApiKey`, `api-keys.ts : 46`:

1. Take the public prefix from the incoming key and look up matching rows. The lookup is cheap and indexed.
2. **bcrypt-compare** the full key against each candidate's hash. This is deliberately slow, which makes guessing keys
   impractical.
3. Skip revoked and expired keys, and keys whose tenant has been deactivated.
4. Return `{ apiKey, tenantId, scopes }`.

### The key decides the tenant

`auth.tenantId` comes from the key row, **never from the request body**. A caller can't say "bill tenant X" or "read
tenant X's data". That's multi-tenancy enforced at the front door.

---

## 4. Step 2: are you allowed? (scopes)

```ts
// route.ts : 82
if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
  return NextResponse.json(
    { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
    { status: 403 },
  );
}
```

Each key carries a list of permissions such as `["rag:read", "graph:read"]`. The scope names are listed in
`packages/auth/src/scopes.ts`. `hasScope` (line 31) accepts any of these:

| Granted scope               | Allows `intelligence:infer`?  |
| --------------------------- | ----------------------------- |
| `intelligence:infer`        | ✅ exact match                |
| `intelligence:*`            | ✅ wildcard for that resource |
| `admin:*` or `*`            | ✅ everything                 |
| `rag:read`, `graph:read`, … | ❌                            |

**401 vs 403:** 401 means "I don't know who you are". 403 means "I know who you are, and you're not allowed to do
this".

`/api/embed` reuses `intelligence:infer` instead of adding a new `intelligence:embed` scope. Embedding is an inference
call, and reusing the scope means existing inference keys work without re-minting.

---

## 5. Step 3: is the input sane? (zod)

```ts
// route.ts : 50–60
const BodySchema = z.object({
  input: z.array(z.string().trim().min(1).max(8_000)).min(1).max(128),
  model: z.literal('small').default('small'), // the only model served
  dimensions: z.number().int().min(64).max(1536).optional(),
});

const parsed = BodySchema.safeParse(raw);
if (!parsed.success) {
  return NextResponse.json(
    { error: 'Invalid request', details: parsed.error.flatten() },
    { status: 400 },
  );
}
```

**Never trust anything that arrives over HTTP.** The schema does three jobs:

- **Rejects garbage** with a clear 400, before anything costs money.
- **Caps sizes** (128 inputs, 8,000 characters each, plus a 200,000-character total check on lines 103–108). That bounds
  what one request can cost you.
- **Caps the response** (lines 110–120): `inputs × dimensions` must be ≤ 150,000, because Vercel refuses responses
  over 4.5 MB. It's checked _before_ Azure is called, so an oversized request is never billed.
- **Fills in defaults**: `model` becomes `'small'` if the caller leaves it out.

`safeParse` returns `{ success, data }` instead of throwing. After this point, `parsed.data` is fully typed and safe to
use.

---

## 6. Step 4: do the work, then respond

```ts
// route.ts : 122–132
try {
  result = await embed(parsed.data.input, {
    model: parsed.data.model,
    dimensions: parsed.data.dimensions,
  });
} catch (err) {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Embedding failed' },
    { status: 502 },
  );
}
```

### Keep the route thin

The route handles only HTTP concerns: headers, auth, validation and status codes. The actual capability lives in
`packages/core/src/inference/embed.ts`. Splitting them this way gives you three things:

- **Other code can reuse the logic.** tRPC procedures, scripts and other routes call `embed()` directly.
- **You can test it without HTTP.** `scripts/verify-embed.ts` calls `embed()` with no API key and no server.
- **The route stays easy to read.** It's the same skeleton as `/api/infer`.

### Record usage when it costs money

```ts
// route.ts : 134–153
try {
  await prisma.usageRecord.create({ data: {
    tenantId: auth.tenantId, apiKeyId: auth.apiKey.id,
    meter: 'EMBEDDINGS', quantity: BigInt(result.tokens), metadata: { … },
  }});
} catch (err) {
  console.error('[api/embed] usage metering failed', err);   // log it, don't fail the request
}
```

This writes one row per call, per tenant and per key, so you can see who's using what. If the ledger write fails, the
error is only logged: Azure has already charged for the call, and failing the request would waste that and break the
user's search.

### Status codes are the contract

The caller reacts differently to each one, so use them precisely:

| Code | Meaning                                       | What the caller should do          |
| ---- | --------------------------------------------- | ---------------------------------- |
| 200  | It worked                                     | Use the result                     |
| 400  | Your input is wrong                           | Fix the code. Retrying won't help. |
| 401  | Your key is missing, wrong or revoked         | Fix the configuration              |
| 403  | Your key isn't allowed to do this             | Fix the key's scopes               |
| 502  | Horus is fine but its upstream (Azure) failed | Fall back and try again later      |

---

## 7. The caller side: CareerCraft

This lives in the other repo (`careercraft-pages`).

### The HTTP call

`supabase/functions/_shared/ai/horus-knowledge.ts : 434`, trimmed:

```ts
export async function horusEmbed(input: string[], options: HorusEmbedOptions = {}) {
  // 1. A deadline: never let a slow Horus hang a user's search.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  // 2. The call itself: URL + key + JSON body.
  const res = await fetch(`${baseUrl()}/api/embed`, {
    method: 'POST',
    headers: authHeaders(), // Authorization: Bearer <key>  (line 70)
    body: JSON.stringify({
      input,
      model: options.model ?? 'small',
      dimensions: options.dimensions,
    }),
    signal: controller.signal,
  });
  clearTimeout(timer);

  // 3. Check the status BEFORE trusting the body.
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`Horus embed: HTTP ${res.status} ${text.slice(0, 200)}`);

  // 4. Check the contract: one vector per input, in order.
  const body = JSON.parse(text);
  if (body.vectors.length !== input.length) throw new ProviderError('…wrong vector count…');
  return body;
}
```

### The fallback

`supabase/functions/_shared/ai/similarity.ts`, `attachSimilarity`, trimmed:

```ts
if (!profile) return 'no-profile'; // user hasn't onboarded → skip, costs nothing
try {
  const { vectors } = await horusEmbed([profile, ...jobTexts], { model: 'small', dimensions: 512 });
  // cosine(vectors[0], vectors[i]) → job.similarity
  return 'ok';
} catch (e) {
  console.warn('[similarity] unavailable, ranking without it:', e);
  return 'unavailable'; // the page still loads, ranked on other signals
}
```

The rule to copy: **any call to another service needs a timeout and a fallback.** The Horus database is on the free
tier and pauses when idle, so "Horus is down" is a normal situation, not a rare one.

---

## 8. Where secrets live

| Where                        | What's stored                                                 | Who can read it                     |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| Horus DB `api_keys` table    | bcrypt **hash** + public prefix                               | Nobody can reverse it               |
| CareerCraft Supabase secrets | the **full key** (`HORUS_API_KEY`, `HORUS_KNOWLEDGE_API_KEY`) | Only the edge functions, at runtime |
| The browser                  | **nothing**                                                   | —                                   |

**This is why the call happens in an edge function, not in the React page.** Everything shipped to a browser can be
read by anyone who opens DevTools. The React page calls CareerCraft's own edge function, and the edge function (on a
server) calls Horus with the key.

The environment variables CareerCraft uses for this:

- **`HORUS_BASE_URL`:** the Horus origin, with no path.
- **`HORUS_API_KEY`:** the inference key. `/api/infer` already works with it.
- **`HORUS_KNOWLEDGE_API_KEY`:** the read-only knowledge key. See §10.
- **`HORUS_BYPASS_TOKEN`:** set only for Vercel preview deployments, which sit behind SSO.

---

## 9. Test it by hand

Hitting an endpoint yourself is the fastest way to understand it.

Two tips:

- **Before the `tofu apply`, a good key gets a 502.** The small deployment doesn't exist yet. That 502 still proves
  the key passed, because auth is checked before the model is touched.
- **A 401 or 403 answers the key question** whether or not the deployment exists.

**Git Bash:**

```bash
HORUS=https://<your-horus-domain>        # or http://localhost:3000 with `pnpm dev` running in apps/web
KEY=horus_sk_live_...                    # paste the key; don't commit this anywhere

curl -s -X POST "$HORUS/api/embed" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":["Registered Nurse","Patient Care Assistant"],"dimensions":64}'
```

**PowerShell:**

```powershell
$horus = "https://<your-horus-domain>"
$key   = "horus_sk_live_..."
$body  = '{"input":["Registered Nurse","Patient Care Assistant"],"dimensions":64}'
Invoke-RestMethod -Method Post -Uri "$horus/api/embed" `
  -Headers @{ Authorization = "Bearer $key" } -ContentType "application/json" -Body $body
```

**Reading the response:**

| You see                                              | It means                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `{"vectors":[[…],[…]],"count":2,…}`                  | ✅ Everything works                                                        |
| `401 Missing API key` / `Invalid or revoked API key` | Wrong key, typo, or revoked                                                |
| `403 Missing required scope: intelligence:infer`     | The key exists but lacks the scope. See §10.                               |
| `400 Invalid request` + `details`                    | The body is wrong. `details` says which field.                             |
| `400 Response too large`                             | Too many inputs at too many dimensions. Ask for `"dimensions": 512`.       |
| `502` mentioning a deployment                        | The model deployment doesn't exist (run the `tofu apply`) or Azure is down |
| An HTML page instead of JSON                         | You hit Vercel's SSO wall (preview deployment) or the wrong URL            |

**Try breaking it on purpose:**

1. Remove the header.
2. Send `"input": []`.
3. Send `"dimensions": 5000`.

Each failure should map to a line in `route.ts`. Finding which one is the fastest way to learn the file.

---

## 10. The key-scope check

**The problem.** CareerCraft's `apiKey()` helper (`horus-knowledge.ts : 66`) sends `HORUS_KNOWLEDGE_API_KEY` if it's
set, and falls back to `HORUS_API_KEY` otherwise. `horusEmbed` uses that helper. CareerCraft's active keys in the
Horus database:

| Key name               | Public prefix          | Scopes                                              | Can call `/api/embed`? |
| ---------------------- | ---------------------- | --------------------------------------------------- | ---------------------- |
| CareerCraft web        | `horus_sk_live_SxedHV` | rag:read, graph:read, entities:read, documents:read | ❌                     |
| CareerCraft web (prod) | `horus_sk_live_wwSOIu` | intelligence:infer + the four reads                 | ✅                     |

If `HORUS_KNOWLEDGE_API_KEY` is the `SxedHV` key, **every embed call returns 403**. CareerCraft catches it and ranks
without similarity. Nothing looks broken, and the feature simply never works.

**How to check.** Use any of these:

- **Look at the key yourself.** Open wherever you set CareerCraft's function secrets locally and compare the first 20
  characters of `HORUS_KNOWLEDGE_API_KEY` with the table above. You can't read production values back from Supabase:
  `supabase secrets list` shows only digests.
- **Run the §9 `curl` with that key.** A 403 confirms the problem.
- **After deploying, do one search** and look for `HTTP 403` in the `[similarity]` log line.

**How to fix.** Pick one:

**A. CareerCraft uses the inference key for embeddings (recommended).** Embedding spends money, so it belongs on the
key that's allowed to spend. `HORUS_API_KEY` already works for `/api/infer`, which needs the same scope, so it's
guaranteed to work here too. In `horus-knowledge.ts`, inside `horusEmbed`:

```ts
// Embedding spends compute, so it goes on the inference key rather than the read-only knowledge key.
const headers = new Headers(authHeaders());
headers.set("Authorization", `Bearer ${reqEnv("HORUS_API_KEY")}`);

res = await fetch(`${baseUrl()}/api/embed`, {
  method: "POST",
  headers,                                  // was: authHeaders()
  …
```

**B. Give the read-only key the scope.** Run this in the Supabase SQL editor for the **Horus** project:

```sql
UPDATE api_keys
SET scopes = array_append(scopes, 'intelligence:infer')
WHERE "keyPrefix" = 'horus_sk_live_SxedHV'
  AND NOT ('intelligence:infer' = ANY (scopes));
```

It's quick, but the "read-only" key stops being read-only.

**C. Mint a fresh key** from `/t/careercraft/settings`, set it as `HORUS_KNOWLEDGE_API_KEY` with
`supabase secrets set`, and revoke the old key. It works, but Settings keys get broad default scopes, including write
scopes.

---

## 11. Recipe: build your own endpoint

### Server side (Horus)

Create `apps/web/src/app/api/<name>/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasAllScopes, SCOPES } from '@horus/auth';
import { doTheWork } from '@horus/core/<module>'; // the logic lives in core, not here

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  text: z.string().trim().min(1).max(8_000), // always cap sizes
});

export async function POST(req: Request) {
  // 1. Who are you?
  const token = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  const auth = token ? await validateApiKey(token) : null;
  if (!auth) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });

  // 2. Are you allowed?
  if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
    return NextResponse.json(
      { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
      { status: 403 },
    );
  }

  // 3. Is the input sane?
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 4. Do the work. Tenant comes from the key, never the body.
  try {
    const result = await doTheWork(parsed.data, auth.tenantId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 502 },
    );
  }
}
```

### Client side (CareerCraft, server-side code only)

```ts
export async function horusDoTheWork(text: string) {
  const res = await fetch(`${reqEnv('HORUS_BASE_URL')}/api/<name>`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reqEnv('HORUS_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000), // never hang
  });
  if (!res.ok) throw new Error(`Horus ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// …and at the call site: try { … } catch { fall back to something sensible }
```

### Checklist

1. **Put the logic in `packages/core`,** exported from a subpath such as `@horus/core/inference`. Keep the route thin.
2. **Pick a scope.** Reuse one if it fits; otherwise add it to `packages/auth/src/scopes.ts`.
3. **Make sure the caller's key actually has that scope.** This is the step §10 is about.
4. **Write a zod schema** with size limits.
5. **Record usage** (`prisma.usageRecord.create`) if the endpoint costs money.
6. **Document the request and response shape** where the caller will look. For CareerCraft that's
   `docs/CAREERCRAFT-INTEGRATION.md`.
7. **Give the caller a timeout and a fallback.**
8. **Hit it by hand** (§9) before wiring up the caller.
9. **Typecheck:** run `npx tsc --noEmit` in `apps/web` (and in `packages/core` if you touched it).

---

## 12. Practice exercises

Build these locally with `pnpm dev` in `apps/web`, then test them with `curl`. Delete them afterwards if you don't
want to keep them.

### Exercise 1: `GET /api/whoami` (steps 1 and 2 only)

Return the tenant, key name, prefix and scopes of whichever key calls it. It's a genuinely useful debugging tool: it
would answer the §10 question in one request.

**Hints:**

- **Method:** export `GET` instead of `POST`.
- **No body:** there's nothing to validate.
- **Never return `keyHash`.**

<details>
<summary>Solution</summary>

```ts
// apps/web/src/app/api/whoami/route.ts
import { NextResponse } from 'next/server';
import { validateApiKey } from '@horus/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  const auth = token ? await validateApiKey(token) : null;
  if (!auth) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });

  return NextResponse.json({
    tenantId: auth.tenantId,
    name: auth.apiKey.name,
    prefix: auth.apiKey.keyPrefix,
    scopes: auth.scopes,
  });
}
```

Test it with `curl -s "$HORUS/api/whoami" -H "Authorization: Bearer $KEY"`.

</details>

### Exercise 2: `POST /api/compare` (all four steps)

Take `{ a: string, b: string }` and return `{ similarity: number }`, how close the two texts are in meaning. This
reuses `embed()` from core.

**Hints:**

- **Scope:** `intelligence:infer`, because it costs tokens.
- **The call:** `embed([a, b], { dimensions: 512 })` returns two vectors.
- **Cosine:** copy the loop from `scripts/verify-embed.ts : 45`.
- **Test values:** "Registered Nurse" vs "Enrolled Nurse" should score well above "Registered Nurse" vs "Forklift
  Operator".

<details>
<summary>Solution</summary>

```ts
// apps/web/src/app/api/compare/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasAllScopes, SCOPES } from '@horus/auth';
import { embed } from '@horus/core/inference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  a: z.string().trim().min(1).max(2_000),
  b: z.string().trim().min(1).max(2_000),
});

function cosine(x: number[], y: number[]): number {
  let dot = 0,
    nx = 0,
    ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i]! * y[i]!;
    nx += x[i]! * x[i]!;
    ny += y[i]! * y[i]!;
  }
  return dot / Math.sqrt(nx * ny);
}

export async function POST(req: Request) {
  const token = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  const auth = token ? await validateApiKey(token) : null;
  if (!auth) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  if (!hasAllScopes(auth.scopes, [SCOPES.INTELLIGENCE_INFER])) {
    return NextResponse.json(
      { error: `Missing required scope: ${SCOPES.INTELLIGENCE_INFER}` },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { vectors } = await embed([parsed.data.a, parsed.data.b], { dimensions: 512 });
    return NextResponse.json({ similarity: cosine(vectors[0]!, vectors[1]!) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 502 },
    );
  }
}
```

</details>

**Stretch goal:** add usage recording to Exercise 2. Copy step 5 from `api/embed/route.ts`, then check that a row
appears in `usage_records` after a call.

---

## 13. The same pattern in tRPC

CareerCraft also calls Horus's **tRPC** procedures, like `budget.allocations`, through `/api/trpc`. It's the same four
steps in different packaging:

| REST route (`/api/embed`)              | tRPC procedure (`budget.allocations`)           |
| -------------------------------------- | ----------------------------------------------- |
| You write `readKey` + `validateApiKey` | `createTRPCContext` does it for every procedure |
| You write `hasAllScopes(…)`            | `scopedProcedure('graph:read')` does it         |
| zod `safeParse` → 400                  | `.input(z.object(…))` → `BAD_REQUEST`           |
| `NextResponse.json(…, { status })`     | return a value, or throw a `TRPCError`          |

Use a **REST route** when the caller wants a plain URL with a JSON body, like `/api/infer` or `/api/embed`. Use a
**tRPC procedure** when it's a query over Horus's data, like the budget or careers routers. For how CareerCraft calls
tRPC without the SDK, see `docs/CAREERCRAFT-INTEGRATION.md` §3.

---

## 14. File map

**Horus** (`horus-platform/`):

| File                                              | What it is                                                    |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `apps/web/src/app/api/embed/route.ts`             | The endpoint: auth, scope, validation, usage recording        |
| `apps/web/src/app/api/infer/route.ts`             | The older sibling. Same skeleton, for text generation.        |
| `packages/core/src/inference/embed.ts`            | The capability: one Azure call, truncation, timeout, ordering |
| `packages/core/src/clients/openai.ts`             | Azure OpenAI client and deployment names (`MODELS`)           |
| `packages/auth/src/api-keys.ts`                   | Key generation (line 22) and validation (line 46)             |
| `packages/auth/src/scopes.ts`                     | Scope names and `hasScope` wildcard rules (line 31)           |
| `apps/web/src/app/t/[tenant]/settings/actions.ts` | Creating keys from the UI, with default scopes                |
| `apps/web/src/middleware.ts`                      | Cookie refresh only. It doesn't protect `/api`.               |
| `infrastructure/tofu/modules/foundry/main.tf`     | The `text-embedding-3-small` deployment (line 151)            |
| `scripts/verify-embed.ts`                         | Live checks and the small vs large comparison                 |
| `docs/CAREERCRAFT-INTEGRATION.md` §10             | The contract CareerCraft codes against                        |
| `docs/EMBED-WALKTHROUGH.html`                     | Guided read-through of the embed build                        |

**CareerCraft** (`careercraft-pages/`):

| File                                               | What it is                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `supabase/functions/_shared/ai/horus-knowledge.ts` | `horusEmbed` (line 434), `authHeaders` (line 70), `apiKey()` (line 66) |
| `supabase/functions/_shared/ai/similarity.ts`      | `attachSimilarity`: the fallback and the cosine scoring                |
| `supabase/functions/_shared/ai/horus.ts`           | `horusInfer`: the `/api/infer` caller, for comparison                  |
