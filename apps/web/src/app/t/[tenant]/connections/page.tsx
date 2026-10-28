import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { checkMcpHealth, listMcpTools, type McpServerRef } from '@horus/core/mcp';
import { PLAYGROUND } from '@/app/api/playground/_lib/config';
import { isPlatformAdmin, requireTenantMember } from '@/lib/tenant-context';
import { addConnectionAction, removeConnectionAction, testConnectionsAction } from './actions';

export const metadata = { title: 'Connections · Horus' };
export const dynamic = 'force-dynamic';

/**
 * What this workspace is connected to — the tool servers (MCP) its agents can
 * call and, for Horus operators only, the platform stack and playground demo
 * servers behind every tenant. Tool-server status is a live probe: Horus
 * connects as an MCP client and lists tools on every render.
 */

interface PlatformService {
  name: string;
  kind: string;
  endpoint: string | null;
  detail?: string;
}

interface ToolServer {
  name: string;
  slug: string;
  endpoint: string;
  source: 'workspace' | 'platform demo';
  /** DB row id — present for workspace connections (removable). */
  id?: string;
  ok: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
}

function platformStack(): PlatformService[] {
  const env = process.env;
  return [
    {
      name: 'Azure AI Foundry — models',
      kind: 'inference',
      endpoint: env.AZURE_OPENAI_ENDPOINT ?? null,
      detail: [env.AZURE_OPENAI_FAST_MODEL, env.AZURE_OPENAI_EMBEDDING_MODEL]
        .filter(Boolean)
        .join(' · '),
    },
    {
      name: 'Foundry Agent Service',
      kind: 'agents',
      endpoint: env.AZURE_AI_PROJECT_ENDPOINT ?? null,
      detail: 'Entra auth · threads + runs',
    },
    {
      name: 'Azure AI Search',
      kind: 'knowledge',
      endpoint: env.AZURE_SEARCH_ENDPOINT ?? null,
      detail: 'hybrid vector + BM25 · tenant partitioned',
    },
    {
      name: 'Realtime voice',
      kind: 'voice',
      endpoint: env.AZURE_OPENAI_REALTIME_DEPLOYMENT
        ? `${env.AZURE_OPENAI_ENDPOINT ?? ''}openai/v1/realtime`
        : null,
      detail: env.AZURE_OPENAI_REALTIME_DEPLOYMENT ?? undefined,
    },
    {
      name: 'Content Safety',
      kind: 'moderation',
      endpoint: env.AZURE_CONTENT_SAFETY_ENDPOINT ?? null,
      detail: 'screens ingest + chat',
    },
  ];
}

async function probe(
  ref: McpServerRef,
): Promise<{ ok: boolean; toolCount: number; tools: string[]; error?: string }> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('probe timed out')), 4_000),
  );
  try {
    const health = await Promise.race([checkMcpHealth(ref), timeout]);
    if (!health.ok) return { ok: false, toolCount: 0, tools: [], error: health.error };
    const tools = await listMcpTools(ref);
    return { ok: true, toolCount: tools.length, tools: tools.map((t) => t.name) };
  } catch (err) {
    return {
      ok: false,
      toolCount: 0,
      tools: [],
      error: err instanceof Error ? err.message : 'unreachable',
    };
  }
}

async function toolServers(tenantId: string, includeDemo: boolean): Promise<ToolServer[]> {
  // Demo servers feed the public playground, not tenant agents — operators only.
  const servers: Array<{
    ref: McpServerRef;
    name: string;
    source: ToolServer['source'];
    id?: string;
  }> = (includeDemo ? PLAYGROUND.mcpServers : []).map((ref) => ({
    ref,
    name: ref.label.replace(/_/g, ' '),
    source: 'platform demo' as const,
  }));

  // Workspace-registered connections (DB registry, RLS-scoped table).
  const rows = await prisma.connection.findMany({
    where: { kind: 'MCP', tenantId },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) {
    const secret =
      row.authType === 'bearer' && row.secretRef ? process.env[row.secretRef] : undefined;
    servers.push({
      ref: {
        label: row.slug,
        url: row.endpoint,
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      },
      name: row.name,
      source: 'workspace',
      id: row.id,
    });
  }

  return Promise.all(
    servers.map(async ({ ref, name, source, id }) => {
      const health = await probe(ref);
      return { name, slug: ref.label, endpoint: ref.url, source, id, ...health };
    }),
  );
}

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Pill tone={ok ? 'success' : 'danger'}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label ?? (ok ? 'connected' : 'unreachable')}
    </Pill>
  );
}

export default async function ConnectionsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, user } = await requireTenantMember(slug);
  const operator = isPlatformAdmin(user.email);
  const stack = operator ? platformStack() : [];
  const servers = await toolServers(tenant.id, operator);

  const configured = stack.filter((s) => s.endpoint).length;
  const liveServers = servers.filter((s) => s.ok).length;
  const totalTools = servers.reduce((n, s) => n + s.toolCount, 0);

  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';
  const testAll = testConnectionsAction.bind(null, slug);
  const add = addConnectionAction.bind(null, slug);
  const remove = removeConnectionAction.bind(null, slug);

  return (
    <>
      <PageHeader
        eyebrow="Connections"
        title="Everything this workspace is wired to."
        description={`${operator ? 'The platform stack Horus runs on, plus the' : 'The'} tool servers (MCP) your agents can call. Tool-server status is probed live — Horus connects as an MCP client and lists what each server offers.`}
        actions={
          <form action={testAll}>
            <Button variant="outline" size="sm" type="submit">
              Test all
            </Button>
          </form>
        }
      />

      <div
        className={`reveal-stagger grid gap-4 ${operator ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}
      >
        {operator && <StatCard label="Platform services" value={`${configured}/${stack.length}`} />}
        <StatCard label="Tool servers" value={String(servers.length)} />
        <StatCard label="Live now" value={String(liveServers)} />
        <StatCard label="Agent tools available" value={String(totalTools)} />
      </div>

      <Reveal as="div" className="mt-8 space-y-6">
        {operator && (
          <Panel
            title="Platform stack"
            description="Azure services this deployment is configured against."
          >
            <ul className="divide-hairline -my-2 divide-y">
              {stack.map((s) => (
                <li key={s.name} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink text-[14px] font-medium">{s.name}</span>
                      <Pill>{s.kind}</Pill>
                    </div>
                    <div className="font-technical text-ink-mute mt-0.5 truncate text-[11.5px]">
                      {s.endpoint ?? 'not configured'}
                      {s.detail ? `  ·  ${s.detail}` : ''}
                    </div>
                  </div>
                  <StatusPill ok={Boolean(s.endpoint)} label={s.endpoint ? 'configured' : 'off'} />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel
          title="Tool servers · MCP"
          description="External capabilities your agents can use. Horus is the MCP client, so servers on private networks work too."
        >
          {canManage && (
            <details className="border-hairline mb-5 rounded-xl border">
              <summary className="text-accent cursor-pointer select-none px-4 py-3 text-[13px] font-medium">
                + Add MCP connection
              </summary>
              <form action={add} className="border-hairline grid gap-3 border-t p-4 sm:grid-cols-2">
                <input
                  name="name"
                  placeholder="Display name (e.g. Interview Coach)"
                  required
                  maxLength={80}
                  className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 h-9 rounded-lg border px-3 text-[13px] outline-none"
                />
                <input
                  name="slug"
                  placeholder="tool namespace (e.g. interview_coach)"
                  required
                  pattern="[a-z][a-z0-9_]{1,31}"
                  title="lowercase letters, digits, underscores; starts with a letter"
                  className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 mono h-9 rounded-lg border px-3 text-[12.5px] outline-none"
                />
                <input
                  name="endpoint"
                  placeholder="https://server.example.com/mcp"
                  required
                  type="url"
                  className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 mono h-9 rounded-lg border px-3 text-[12.5px] outline-none sm:col-span-2"
                />
                <input
                  name="secretRef"
                  placeholder="Env var holding a bearer secret (optional)"
                  className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 mono h-9 rounded-lg border px-3 text-[12.5px] outline-none"
                />
                <div className="flex items-center justify-end">
                  <Button size="sm" type="submit">
                    Connect &amp; discover tools
                  </Button>
                </div>
              </form>
            </details>
          )}

          {servers.length === 0 ? (
            <p className="text-ink-faded py-2 text-[14px]">
              No tool servers connected yet. Register one and its tools become available to every
              agent in this workspace.
            </p>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {servers.map((s) => (
                <li key={`${s.source}-${s.slug}`} className="py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink text-[14px] font-medium capitalize">
                          {s.name}
                        </span>
                        <Pill tone="accent">MCP</Pill>
                        <Pill>{s.source}</Pill>
                      </div>
                      <div className="font-technical text-ink-mute mt-0.5 truncate text-[11.5px]">
                        {s.endpoint}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.ok && (
                        <span className="num text-ink-faded text-[12px]">{s.toolCount} tools</span>
                      )}
                      <StatusPill ok={s.ok} />
                      {canManage && s.id && (
                        <form action={remove}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button variant="outline" size="sm" type="submit">
                            Remove
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                  {s.ok && s.tools.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {s.tools.slice(0, 10).map((t) => (
                        <span
                          key={t}
                          className="border-hairline text-ink-faded font-technical rounded-full border px-2 py-0.5 text-[10.5px]"
                        >
                          {t}
                        </span>
                      ))}
                      {s.tools.length > 10 && (
                        <span className="text-ink-mute text-[10.5px]">
                          +{s.tools.length - 10} more
                        </span>
                      )}
                    </div>
                  )}
                  {!s.ok && s.error && (
                    <p className="text-ink-mute mt-1.5 text-[12px]">{s.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
