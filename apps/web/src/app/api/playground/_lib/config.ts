/**
 * Playground limits + scope. Open-access demo tenant: everything here exists
 * to keep an anonymous playground from becoming a cost or abuse hole.
 * Env-overridable so prod can tighten/loosen without a deploy.
 */
import type { McpServerRef } from '@horus/core/mcp';

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Demo MCP connections for the open playground (real tenants use the DB
 * registry instead). JSON: [{"label":"interview_coach","url":"http://...mcp","secretEnv":"..."}]
 */
function mcpServers(): McpServerRef[] {
  const raw = process.env.PLAYGROUND_MCP_SERVERS;
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw) as Array<{ label: string; url: string; secretEnv?: string }>;
    return entries
      .filter((e) => /^[a-z][a-z0-9_]{1,31}$/.test(e.label) && /^https?:\/\//.test(e.url))
      .map((e) => {
        const secret = e.secretEnv ? process.env[e.secretEnv] : undefined;
        return {
          label: e.label,
          url: e.url,
          headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
        };
      });
  } catch {
    console.warn('PLAYGROUND_MCP_SERVERS is not valid JSON — ignoring');
    return [];
  }
}

export const PLAYGROUND = {
  /** All playground knowledge lives under this tenant partition. */
  tenantId: 'playground',
  indexName: process.env.AZURE_SEARCH_PLAYGROUND_INDEX ?? 'horus-playground',

  maxPagesPerCrawl: int(process.env.PLAYGROUND_MAX_PAGES, 20),
  maxPdfBytes: int(process.env.PLAYGROUND_MAX_PDF_MB, 15) * 1024 * 1024,
  maxSourcesPerSession: int(process.env.PLAYGROUND_MAX_SOURCES, 8),
  maxChunksPerIngest: int(process.env.PLAYGROUND_MAX_CHUNKS_PER_INGEST, 300),
  maxChunksPerSession: int(process.env.PLAYGROUND_MAX_CHUNKS_PER_SESSION, 900),

  /** Ephemeral knowledge: swept opportunistically after this many hours. */
  sessionTtlHours: int(process.env.PLAYGROUND_SESSION_TTL_HOURS, 24),
  topK: 8,

  /** MCP tool servers attached to the playground agent. */
  mcpServers: mcpServers(),

  rate: {
    ingestPerHour: int(process.env.PLAYGROUND_RATE_INGEST, 10),
    chatPerHour: int(process.env.PLAYGROUND_RATE_CHAT, 60),
    /** Realtime voice sessions minted per hour (each is a live full-duplex call). */
    voicePerHour: int(process.env.PLAYGROUND_RATE_VOICE, 12),
  },
} as const;
