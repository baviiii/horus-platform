/**
 * runKnowledgeAgent — chat turns through the Foundry Agent Service.
 *
 * One persistent agent (created lazily, updated on process start) carries the
 * instructions + toolset: our function tools (knowledge search, page fetch)
 * executed here, plus Grounding-with-Bing executed server-side by Foundry
 * when connected. Each turn runs on a throwaway thread seeded with the
 * client-held history; run events stream out as the same AgentEvent shape
 * the playground UI already renders.
 */
import type {
  Agent,
  MessageDeltaChunk,
  MessageDeltaTextContent,
  RunStep,
  SubmitToolOutputsAction,
  ThreadRun,
  ToolDefinitionUnion,
  ToolOutput,
} from '@azure/ai-agents';
import { getAgentsClient } from '../clients/agents.js';
import { resolveDeployment, type ModelTier } from '../inference/infer.js';
import { listSessionSources } from '../knowledge/store.js';
import { callMcpTool, listMcpTools, type McpServerRef } from '../mcp/client.js';
import {
  buildAgentTools,
  CitationRegistry,
  executeFetchPage,
  executeGraphLookup,
  executeSearchKnowledge,
  type AgentCitation,
  type ToolScope,
} from './tools.js';

export type AgentEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool'; name: string; status: 'start' | 'end'; detail?: string }
  | { kind: 'citations'; citations: AgentCitation[] }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number } };

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentParams {
  indexName: string;
  tenantId: string;
  sessionId: string;
  messages: AgentChatMessage[];
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  model?: ModelTier;
  topK?: number;
  /** Optional persona injected as additional instructions (customer-facing agents). */
  persona?: string;
  /** Optional agent display name, used with persona. */
  personaName?: string;
  /** Tenant-connected MCP tool servers; their tools attach to this run. */
  mcpServers?: McpServerRef[];
  /** Restrict retrieval to these sourceIds (collection-scoped agents). */
  sourceIds?: string[];
}

const AGENT_NAME = 'horus-knowledge-agent';
const MAX_TOOL_ROUNDS = 4;
const MAX_TOOL_CALLS = 6;

const SYSTEM_PROMPT = `You are a knowledge agent powered by Horus. The user has connected websites and documents to this session; that knowledge base is your source of truth.

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
const DEFAULT_STYLE = `\n\nAnswers may be spoken aloud by a voice interface: be concise and conversational. Prefer a short direct answer followed by brief supporting detail.`;

async function describeSources(scope: ToolScope): Promise<string> {
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

// One agent per deployment, ensured once per process. Update-on-start keeps
// the hosted definition in lockstep with this code (instructions + tools are
// versioned here, not in the portal).
const ensuredAgents = new Map<string, Promise<Agent>>();

function ensureAgent(deployment: string): Promise<Agent> {
  let pending = ensuredAgents.get(deployment);
  if (!pending) {
    pending = (async () => {
      const client = getAgentsClient();
      const definition = {
        name: AGENT_NAME,
        instructions: SYSTEM_PROMPT,
        tools: buildAgentTools(),
        temperature: 0.4,
      };
      for await (const existing of client.listAgents({ limit: 100 })) {
        if (existing.name === AGENT_NAME) {
          return client.updateAgent(existing.id, { model: deployment, ...definition });
        }
      }
      return client.createAgent(deployment, definition);
    })().catch((err: unknown) => {
      ensuredAgents.delete(deployment); // allow retry after transient failure
      throw err;
    });
    ensuredAgents.set(deployment, pending);
  }
  return pending;
}

/**
 * MCP tools become per-run function tools named `mcp__<label>__<tool>`.
 * The route map turns a requested name back into (server, tool) so the
 * requires_action handler can execute it through the MCP client.
 */
interface McpToolset {
  tools: ToolDefinitionUnion[];
  route: Map<string, { ref: McpServerRef; tool: string }>;
  labels: string[];
}

async function buildMcpToolset(servers: McpServerRef[]): Promise<McpToolset> {
  const toolset: McpToolset = { tools: [], route: new Map(), labels: [] };
  for (const ref of servers) {
    try {
      const tools = await listMcpTools(ref);
      for (const t of tools) {
        const name = `mcp__${ref.label}__${t.name}`;
        if (name.length > 64) {
          console.warn(`mcp tool name too long, skipped: ${name}`);
          continue;
        }
        toolset.tools.push({
          type: 'function',
          function: {
            name,
            description: t.description.slice(0, 512),
            parameters: t.inputSchema,
          },
        });
        toolset.route.set(name, { ref, tool: t.name });
      }
      toolset.labels.push(ref.label);
    } catch (err) {
      // Server unreachable — the agent simply runs without its tools.
      console.warn(
        `mcp server "${ref.label}" unavailable:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return toolset;
}

/** Minimal structural view of tool-call run steps (SDK unions are broader). */
interface ToolCallsStepDetails {
  type: string;
  toolCalls?: Array<{ type: string; id: string }>;
}

function bingCallCount(step: RunStep): number {
  const details = step.stepDetails as ToolCallsStepDetails | undefined;
  if (details?.type !== 'tool_calls') return 0;
  return (details.toolCalls ?? []).filter((tc) => tc.type === 'bing_grounding').length;
}

export async function runKnowledgeAgent(params: RunAgentParams): Promise<void> {
  const { emit, signal } = params;
  const client = getAgentsClient();
  const deployment = resolveDeployment(params.model ?? 'fast');
  const agent = await ensureAgent(resolveDeployment('fast'));

  const scope: ToolScope = {
    indexName: params.indexName,
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    topK: params.topK ?? 8,
    ...(params.sourceIds && { sourceIds: params.sourceIds }),
  };
  const registry = new CitationRegistry();
  let toolCallBudget = MAX_TOOL_CALLS;

  const mcp = params.mcpServers?.length ? await buildMcpToolset(params.mcpServers) : null;
  const mcpNote =
    mcp && mcp.labels.length > 0
      ? `\n\nConnected tool servers: ${mcp.labels.join(', ')}. Use their tools directly whenever the user asks for those capabilities (coaching, interviews, planning, ...) — do not describe what you would do, call the tool.`
      : '';

  const personaNote = params.persona
    ? `\n\nYou are ${params.personaName ?? 'an assistant'}. ${params.persona}`
    : DEFAULT_STYLE;

  const thread = await client.threads.create({ abortSignal: signal });
  try {
    let response = client.runs.create(thread.id, agent.id, {
      abortSignal: signal,
      model: deployment === agent.model ? undefined : deployment,
      additionalInstructions: (await describeSources(scope)) + mcpNote + personaNote,
      additionalMessages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      // Tool list override: base tools + this tenant's MCP tools for this run.
      tools: mcp && mcp.tools.length > 0 ? [...buildAgentTools(), ...mcp.tools] : undefined,
      maxCompletionTokens: 1100,
      parallelToolCalls: true,
    });

    let completedRun: ThreadRun | null = null;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let requiresAction: ThreadRun | null = null;

      const stream = await response.stream();
      for await (const event of stream) {
        switch (event.event) {
          case 'thread.message.delta': {
            const chunk = event.data as MessageDeltaChunk;
            for (const part of chunk.delta.content ?? []) {
              if (part.type !== 'text') continue;
              const text = (part as MessageDeltaTextContent).text;
              if (text?.value) emit({ kind: 'token', text: text.value });
              for (const annotation of text?.annotations ?? []) {
                if (annotation.type === 'url_citation') {
                  const { url, title } = (
                    annotation as { urlCitation: { url: string; title?: string } }
                  ).urlCitation;
                  registry.register({
                    key: url,
                    title: title || new URL(url).hostname,
                    url,
                    sourceType: 'web',
                    snippet: '',
                  });
                }
              }
            }
            break;
          }
          case 'thread.run.step.created': {
            const bingCalls = bingCallCount(event.data as RunStep);
            if (bingCalls > 0) emit({ kind: 'tool', name: 'web_search', status: 'start' });
            break;
          }
          case 'thread.run.step.completed': {
            const bingCalls = bingCallCount(event.data as RunStep);
            if (bingCalls > 0) emit({ kind: 'tool', name: 'web_search', status: 'end' });
            break;
          }
          case 'thread.run.requires_action':
            requiresAction = event.data as ThreadRun;
            break;
          case 'thread.run.completed':
            completedRun = event.data as ThreadRun;
            break;
          case 'thread.run.failed':
          case 'thread.run.expired': {
            const run = event.data as ThreadRun;
            throw new Error(run.lastError?.message ?? `Agent run ${event.event}`);
          }
          case 'error':
            throw new Error(String(event.data));
          default:
            break; // unknown events are expected to be ignored
        }
      }

      if (!requiresAction) break;

      // The SDK union's base type is not discriminated; narrow by hand.
      const requiredAction = requiresAction.requiredAction;
      const toolCalls =
        requiredAction?.type === 'submit_tool_outputs'
          ? (requiredAction as SubmitToolOutputsAction).submitToolOutputs.toolCalls
          : [];

      const outputs: ToolOutput[] = [];
      for (const call of toolCalls) {
        if (call.type !== 'function') continue;
        const { name, arguments: rawArgs } = (
          call as { function: { name: string; arguments: string } }
        ).function;
        toolCallBudget--;

        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
        } catch {
          /* fall through with empty args */
        }

        const mcpTarget = mcp?.route.get(name);
        let result: string;
        if (toolCallBudget < 0 || round === MAX_TOOL_ROUNDS) {
          result = 'Tool budget exhausted — answer now with what you have.';
        } else if (name === 'search_knowledge' && typeof parsed.query === 'string') {
          emit({ kind: 'tool', name: 'search_knowledge', status: 'start', detail: parsed.query });
          result = await executeSearchKnowledge(scope, registry, parsed.query);
          emit({ kind: 'tool', name: 'search_knowledge', status: 'end' });
        } else if (name === 'fetch_page' && typeof parsed.url === 'string') {
          emit({ kind: 'tool', name: 'fetch_page', status: 'start', detail: parsed.url });
          result = await executeFetchPage(registry, parsed.url);
          emit({ kind: 'tool', name: 'fetch_page', status: 'end' });
        } else if (name === 'graph_lookup' && typeof parsed.entity === 'string') {
          emit({ kind: 'tool', name: 'graph_lookup', status: 'start', detail: parsed.entity });
          result = await executeGraphLookup(scope, registry, parsed.entity);
          emit({ kind: 'tool', name: 'graph_lookup', status: 'end' });
        } else if (mcpTarget) {
          const display = `${mcpTarget.ref.label}:${mcpTarget.tool}`;
          emit({ kind: 'tool', name: display, status: 'start' });
          result = await callMcpTool(mcpTarget.ref, mcpTarget.tool, parsed);
          emit({ kind: 'tool', name: display, status: 'end' });
        } else {
          result = `Unknown tool or invalid arguments for "${name}".`;
        }
        outputs.push({ toolCallId: call.id, output: result });
      }

      response = client.runs.submitToolOutputs(thread.id, requiresAction.id, outputs, {
        abortSignal: signal,
      });
    }

    const citations = registry.all();
    if (citations.length > 0) emit({ kind: 'citations', citations });
    emit({
      kind: 'done',
      usage: {
        inputTokens: completedRun?.usage?.promptTokens ?? 0,
        outputTokens: completedRun?.usage?.completionTokens ?? 0,
      },
    });
  } finally {
    // Throwaway thread — history lives client-side; don't accumulate server state.
    client.threads.delete(thread.id).catch(() => undefined);
  }
}
