'use client';

import * as React from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { cn } from '@/lib/cn';

type ProtocolTab = 'mcp' | 'curl' | 'ts' | 'python';

export function SnippetTabs({
  origin,
  slug,
  kind,
  firstToolName,
  sampleQuery,
  apiKey,
  collectionSlug,
  compact = false,
}: {
  origin: string;
  slug: string;
  kind: 'INDEX' | 'MCP';
  firstToolName?: string;
  sampleQuery?: string;
  /** Optional newly minted plaintext key; defaults to placeholder when absent. */
  apiKey?: string | null;
  collectionSlug?: string | null;
  compact?: boolean;
}) {
  const [tab, setTab] = React.useState<ProtocolTab>('mcp');
  const [copied, setCopied] = React.useState(false);

  const keyToken = apiKey || 'horus_sk_live_YOUR_API_KEY';
  const collParam =
    slug === 'workspace' && collectionSlug
      ? `?collection=${encodeURIComponent(collectionSlug)}`
      : '';
  const mcpUrl = `${origin}/api/mcp/${slug}${collParam}`;
  const restUrl = `${origin}/api/v1/marketplace/${slug}/query`;
  const prompt = sampleQuery || 'What funding programs are highlighted in the latest budget?';
  const tool = firstToolName || (kind === 'MCP' ? 'research_role' : 'search_index');

  const snippets: Record<ProtocolTab, { label: string; hint: string; code: string }> = {
    mcp: {
      label: 'MCP · Cursor / Claude',
      hint: 'Paste into .cursor/mcp.json, Windsurf, or Claude MCP settings (Streamable HTTP).',
      code: JSON.stringify(
        {
          mcpServers: {
            [`horus-${slug}${collectionSlug ? `-${collectionSlug}` : ''}`]: {
              type: 'http',
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${keyToken}`,
              },
            },
          },
        },
        null,
        2,
      ),
    },
    curl: {
      label: 'REST · cURL',
      hint: 'Call directly from any backend, webhook, or edge function over HTTPS.',
      code:
        kind === 'INDEX'
          ? `curl -X POST "${restUrl}" \\
  -H "Authorization: Bearer ${keyToken}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    {
      mode: 'ask',
      query: prompt,
      maxSources: 8,
      ...(collectionSlug ? { collection: collectionSlug } : {}),
    },
    null,
    2,
  )}'`
          : `curl -X POST "${restUrl}" \\
  -H "Authorization: Bearer ${keyToken}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    {
      mode: 'call',
      tool,
      arguments: { company: 'Atlassian', role: 'Senior Software Engineer' },
    },
    null,
    2,
  )}'`,
    },
    ts: {
      label: 'TypeScript · SDK',
      hint: 'End-to-end typed via @horus/sdk or standard Web fetch in Edge Functions.',
      code:
        kind === 'INDEX'
          ? `import { createHorusClient } from '@horus/sdk';

const horus = createHorusClient({
  baseUrl: '${origin}',
  apiKey: process.env.HORUS_API_KEY!, // ${apiKey ? 'key populated' : 'horus_sk_live_...'}
});

const result = await horus.marketplace.query.mutate({
  slug: '${slug}',${collectionSlug ? `\n  collection: '${collectionSlug}',` : ''}
  mode: 'ask',
  query: ${JSON.stringify(prompt)},
});

console.log(result.answer, result.sources);`
          : `import { createHorusClient } from '@horus/sdk';

const horus = createHorusClient({
  baseUrl: '${origin}',
  apiKey: process.env.HORUS_API_KEY!, // ${apiKey ? 'key populated' : 'horus_sk_live_...'}
});

const result = await horus.marketplace.query.mutate({
  slug: '${slug}',
  mode: 'mcp_call',
  tool: '${tool}',
  arguments: { company: 'Atlassian', role: 'Senior Software Engineer' },
});

console.log(result.output);`,
    },
    python: {
      label: 'Python',
      hint: 'Zero-dependency HTTPS call for Python pipelines, FastAPI, or notebooks.',
      code:
        kind === 'INDEX'
          ? `import httpx

resp = httpx.post(
    "${restUrl}",
    headers={"Authorization": "Bearer ${keyToken}"},
    json={
        "mode": "search",
        "query": ${JSON.stringify(prompt)},
        "topK": 8,${collectionSlug ? `\n        "collection": "${collectionSlug}",` : ''}
    },
    timeout=60.0,
)
resp.raise_for_status()
for hit in resp.json()["hits"]:
    print(f"[{hit['rank']}] {hit['title']} — {hit.get('sourceUrl', '')}")`
          : `import httpx

resp = httpx.post(
    "${restUrl}",
    headers={"Authorization": "Bearer ${keyToken}"},
    json={
        "mode": "call",
        "tool": "${tool}",
        "arguments": {"company": "Atlassian", "role": "Senior Software Engineer"},
    },
    timeout=60.0,
)
resp.raise_for_status()
print(resp.json()["output"])`,
    },
  };

  const active = snippets[tab];

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-secure context
    }
  }

  return (
    <div className="border-hairline bg-paper overflow-hidden rounded-2xl border">
      <div className="border-hairline bg-paper-soft flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(snippets) as ProtocolTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                tab === k
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-ink-faded hover:bg-paper hover:text-ink',
              )}
            >
              {snippets[k].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="border-hairline bg-paper text-ink-soft hover:border-accent/50 hover:text-accent inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="border-hairline bg-paper-soft/50 text-ink-faded flex items-center gap-2 border-b px-4 py-2 text-[11.5px]">
        <Terminal size={12} className="text-accent shrink-0" />
        <span className="truncate">{active.hint}</span>
      </div>

      <pre
        className={cn(
          'font-technical text-ink overflow-x-auto p-4 text-[12px] leading-[1.7]',
          compact ? 'max-h-[260px]' : 'max-h-[380px]',
        )}
      >
        <code>{active.code}</code>
      </pre>
    </div>
  );
}
