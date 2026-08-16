/**
 * Scope strings granted to API keys. Matches against tRPC procedure metadata.
 * Hierarchical: `rag:*` implies `rag:read` and `rag:write`.
 */
export const SCOPES = {
  RAG_READ: 'rag:read',
  RAG_WRITE: 'rag:write',
  AGENTIC_READ: 'agentic:read',
  AGENTIC_WRITE: 'agentic:write',
  GRAPH_READ: 'graph:read',
  GRAPH_WRITE: 'graph:write',
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_WRITE: 'documents:write',
  ENTITIES_READ: 'entities:read',
  ENTITIES_WRITE: 'entities:write',
  ALERTS_READ: 'alerts:read',
  ALERTS_WRITE: 'alerts:write',
  CONNECTIONS_READ: 'connections:read',
  CONNECTIONS_WRITE: 'connections:write',
  INCIDENTS_READ: 'incidents:read',
  INCIDENTS_WRITE: 'incidents:write',
  INTELLIGENCE_INFER: 'intelligence:infer',
  ADMIN: 'admin:*',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: readonly Scope[] = Object.values(SCOPES);

/** Returns true if `granted` covers `required`. Supports `*` wildcards. */
export function hasScope(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (granted.includes('admin:*') || granted.includes('*')) return true;

  const [resource] = required.split(':');
  if (resource && granted.includes(`${resource}:*`)) return true;

  return false;
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((r) => hasScope(granted, r));
}
