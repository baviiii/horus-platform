/**
 * Instructions and limits shared by both agent runtimes — the Foundry Agent
 * Service loop (`run.ts`) and the AI SDK loop (`run-ai-sdk.ts`) —
 * so the two clouds answer under the same rules.
 */
import { listSessionSources } from '../knowledge/store.js';
import type { ToolScope } from './tools.js';

export const MAX_TOOL_ROUNDS = 4;
export const MAX_TOOL_CALLS = 6;

export const SYSTEM_PROMPT = `You are a knowledge agent powered by Horus. The user has connected websites and documents to this session; that knowledge base is your source of truth.

Rules:
- Before answering any factual question, call search_knowledge with a well-phrased query. Re-search with different terms if the first pass misses.
- When the user says "this website", "the document", "the company", or similar, they mean the connected sources listed in the session context. NEVER ask which source they mean or ask for a URL — search the knowledge base first and answer from what comes back.
- Ground every claim in retrieved passages and cite them inline as [n], using the numbers from tool results.
- If the knowledge base has nothing relevant, say so plainly — then use web search if it is available, or suggest what the user could connect. Never invent an answer.
- Use fetch_page only when the user shares a URL mid-conversation or explicitly asks about a live page.
- For questions about how things CONNECT — which programs fund a sector, what skills an occupation needs, what an organization delivers — call graph_lookup on the key entity, then search_knowledge for supporting passages. Cite both.`;

/**
 * Voice and length when the caller supplies no persona. It used to sit in
 * SYSTEM_PROMPT, which meant a consumer's persona asking for a structured or
 * fuller answer contradicted a standing "be concise" — and lost. Style is the
 * persona's to set; the rules above are not.
 */
export const DEFAULT_STYLE = `\n\nAnswers may be spoken aloud by a voice interface: be concise and conversational. Prefer a short direct answer followed by brief supporting detail.`;

export async function describeSources(scope: ToolScope): Promise<string> {
  try {
    const sources = await listSessionSources(scope.indexName, scope.tenantId, scope.sessionId);
    const scoped = scope.sourceIds
      ? sources.filter((s) => scope.sourceIds!.includes(s.sourceId))
      : sources;
    if (scoped.length === 0) {
      return 'Connected sources: none in the assigned collections. If the user asks a factual question, still try search_knowledge once, then tell them no documents are assigned to this agent yet.';
    }
    const lines = scoped
      .map(
        (s) =>
          `- ${s.title || s.sourceUrl} (${s.sourceType === 'url' ? s.sourceUrl : 'uploaded PDF'}, ${s.chunkCount} chunks)`,
      )
      .join('\n');
    return `Connected sources right now:\n${lines}`;
  } catch {
    return 'Connected sources: unavailable — use search_knowledge to discover what is indexed.';
  }
}

export function mcpNote(labels: string[]): string {
  return labels.length > 0
    ? `\n\nConnected tool servers: ${labels.join(', ')}. Use their tools directly whenever the user asks for those capabilities (coaching, interviews, planning, ...) — do not describe what you would do, call the tool.`
    : '';
}

export function personaNote(persona?: string, personaName?: string): string {
  return persona ? `\n\nYou are ${personaName ?? 'an assistant'}. ${persona}` : DEFAULT_STYLE;
}
