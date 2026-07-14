/**
 * Horus as an MCP client.
 *
 * Tenants register MCP servers (interview-coach-mcp is the first); Horus
 * connects over streamable HTTP, discovers their tools, and exposes them to
 * the agent as function tools it executes here. Client-side execution means
 * a server on localhost, a private network, or the public internet all work
 * the same — no dependency on Foundry being able to reach the URL.
 *
 * Servers like interview-coach-mcp are stateless per request, so we connect
 * fresh per operation and keep only the discovered tool list cached.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpServerRef {
  /** Short slug used to namespace tool names: [a-z0-9_], e.g. "interview_coach". */
  label: string;
  /** Streamable-HTTP MCP endpoint, e.g. https://coach.example.com/mcp */
  url: string;
  /** Extra headers (e.g. Authorization) sent on every request. */
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

export interface McpHealth {
  ok: boolean;
  toolCount: number;
  error?: string;
}

const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 60_000; // coach tools can run research + LLM calls
const TOOLS_CACHE_TTL_MS = 5 * 60_000;

async function withClient<T>(
  ref: McpServerRef,
  timeoutMs: number,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(ref.url), {
    requestInit: { headers: ref.headers },
  });
  const client = new Client({ name: 'horus', version: '1.0.0' });
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    await client.connect(transport);
    if (timeout.aborted) throw new Error('MCP connect timed out');
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const toolsCache = new Map<string, { at: number; tools: McpToolInfo[] }>();

/** Discover the server's tools (cached briefly — servers rarely change mid-session). */
export async function listMcpTools(ref: McpServerRef, fresh = false): Promise<McpToolInfo[]> {
  const cacheKey = `${ref.label}|${ref.url}`;
  const cached = toolsCache.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.at < TOOLS_CACHE_TTL_MS) return cached.tools;

  const tools = await withClient(ref, CONNECT_TIMEOUT_MS, async (client) => {
    const result = await client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
  });
  toolsCache.set(cacheKey, { at: Date.now(), tools });
  return tools;
}

/** Call one tool; always returns model-consumable text (errors included). */
export async function callMcpTool(
  ref: McpServerRef,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    return await withClient(ref, CALL_TIMEOUT_MS, async (client) => {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
      const text = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
      if (result.isError) {
        return `Tool "${name}" on ${ref.label} failed: ${text || 'unknown error'}`;
      }
      return text || `Tool "${name}" returned no text content.`;
    });
  } catch (err) {
    return `Could not reach the ${ref.label} tool server (${err instanceof Error ? err.message : 'connection error'}).`;
  }
}

/** Connect + list tools as a health probe (used by the dashboard + registry). */
export async function checkMcpHealth(ref: McpServerRef): Promise<McpHealth> {
  try {
    const tools = await listMcpTools(ref, true);
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    return {
      ok: false,
      toolCount: 0,
      error: err instanceof Error ? err.message : 'connection error',
    };
  }
}
