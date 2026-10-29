/**
 * runKnowledgeAgent on Amazon Bedrock through the AI SDK.
 *
 * The AI SDK runs the tool loop: each step streams the model's text to the
 * caller, runs any requested tools here (knowledge search, page fetch, graph
 * lookup, tenant MCP tools) and feeds the results back. Works with any
 * Bedrock model that supports tool use; the model is a setting
 * (clients/bedrock-models.ts). Emits the same AgentEvent stream as the
 * Foundry runtime, so the routes and UI don't know which cloud answered.
 *
 * History is client-held, as on Azure: nothing persists between turns.
 */
import {
  isStepCount,
  jsonSchema,
  streamText,
  tool,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from 'ai';
import { languageModel, modelId, supportsCachePoint } from '../clients/bedrock-models.js';
import { callMcpTool, listMcpTools, type McpServerRef } from '../mcp/client.js';
import {
  describeSources,
  MAX_TOOL_CALLS,
  MAX_TOOL_ROUNDS,
  mcpNote,
  personaNote,
  SYSTEM_PROMPT,
} from './instructions.js';
import type { AgentChatMessage, RunAgentParams } from './run.js';
import {
  AGENT_FUNCTION_TOOLS,
  CitationRegistry,
  executeFetchPage,
  executeGraphLookup,
  executeSearchKnowledge,
  type ToolScope,
} from './tools.js';

type ToolInput = Record<string, unknown>;

interface FunctionToolShape {
  function: { name: string; description?: string; parameters?: unknown };
}

interface McpTools {
  tools: ToolSet;
  labels: string[];
}

/** Every tool call spends from one budget; past it the model is told to answer. */
type Run = (
  display: string,
  detail: string | undefined,
  work: () => Promise<string>,
) => Promise<string>;

/** The same three knowledge tools the Foundry agent carries. */
function knowledgeTools(scope: ToolScope, registry: CitationRegistry, run: Run): ToolSet {
  const execute: Record<string, (input: ToolInput) => Promise<string>> = {
    search_knowledge: (input) =>
      run('search_knowledge', String(input.query), () =>
        executeSearchKnowledge(scope, registry, String(input.query)),
      ),
    fetch_page: (input) =>
      run('fetch_page', String(input.url), () => executeFetchPage(registry, String(input.url))),
    graph_lookup: (input) =>
      run('graph_lookup', String(input.entity), () =>
        executeGraphLookup(scope, registry, String(input.entity)),
      ),
  };
  const tools: ToolSet = {};
  for (const { function: fn } of AGENT_FUNCTION_TOOLS as unknown as FunctionToolShape[]) {
    const handler = execute[fn.name];
    if (!handler) continue;
    tools[fn.name] = tool({
      description: fn.description ?? '',
      inputSchema: jsonSchema<ToolInput>(fn.parameters as Parameters<typeof jsonSchema>[0]),
      execute: handler,
    });
  }
  return tools;
}

/** MCP tools become `mcp__<label>__<tool>`, under Bedrock's 64-character limit. */
async function buildMcpTools(servers: McpServerRef[], run: Run): Promise<McpTools> {
  const toolset: McpTools = { tools: {}, labels: [] };
  for (const ref of servers) {
    try {
      for (const t of await listMcpTools(ref)) {
        const name = `mcp__${ref.label}__${t.name}`;
        if (name.length > 64) {
          console.warn(`mcp tool name too long, skipped: ${name}`);
          continue;
        }
        toolset.tools[name] = tool({
          description: t.description.slice(0, 512),
          inputSchema: jsonSchema<ToolInput>(t.inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: (input: ToolInput) =>
            run(`${ref.label}:${t.name}`, undefined, () => callMcpTool(ref, t.name, input)),
        });
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

/** Conversations must open on a user turn; client history may start with a greeting. */
function toHistory(messages: AgentChatMessage[]): ModelMessage[] {
  const history = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
  while (history.length > 0 && history[0]!.role !== 'user') history.shift();
  return history;
}

export async function runKnowledgeAgentOnBedrock(params: RunAgentParams): Promise<void> {
  const { emit, signal } = params;
  const tier = params.model ?? 'fast';
  const id = modelId(tier);

  const scope: ToolScope = {
    indexName: params.indexName,
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    topK: params.topK ?? 8,
    ...(params.sourceIds && { sourceIds: params.sourceIds }),
  };
  const registry = new CitationRegistry();
  let toolCallBudget = MAX_TOOL_CALLS;

  const run: Run = async (display, detail, work) => {
    if (--toolCallBudget < 0) return 'Tool budget exhausted — answer now with what you have.';
    emit({ kind: 'tool', name: display, status: 'start', ...(detail && { detail }) });
    try {
      return await work();
    } finally {
      emit({ kind: 'tool', name: display, status: 'end' });
    }
  };

  const mcp = params.mcpServers?.length ? await buildMcpTools(params.mcpServers, run) : null;
  const tools: ToolSet = { ...knowledgeTools(scope, registry, run), ...(mcp?.tools ?? {}) };

  const history = toHistory(params.messages);
  if (history.length === 0) {
    emit({ kind: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
    return;
  }

  // Stable rules first, behind a cache point where the model supports one;
  // the per-turn source list and persona follow it.
  const instructions: SystemModelMessage[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
      ...(supportsCachePoint(id) && {
        providerOptions: { bedrock: { cachePoint: { type: 'default' } } },
      }),
    },
    {
      role: 'system',
      content:
        (await describeSources(scope)) +
        mcpNote(mcp?.labels ?? []) +
        personaNote(params.persona, params.personaName),
    },
  ];

  let failure: unknown = null;
  const result = streamText({
    model: languageModel(tier),
    instructions,
    messages: history,
    tools,
    stopWhen: isStepCount(MAX_TOOL_ROUNDS + 1),
    // Last step: answer with what has been gathered, no more tools.
    prepareStep: ({ stepNumber }) =>
      stepNumber === MAX_TOOL_ROUNDS ? { toolChoice: 'none' as const } : {},
    maxOutputTokens: 8192,
    ...(signal && { abortSignal: signal }),
    onError: ({ error }) => {
      failure = error;
    },
  });

  for await (const delta of result.textStream) emit({ kind: 'token', text: delta });
  if (failure) throw failure;

  if ((await result.finishReason) === 'content-filter') {
    emit({ kind: 'token', text: "\n\nI can't help with that request." });
  }

  const total = await result.totalUsage;
  const citations = registry.all();
  if (citations.length > 0) emit({ kind: 'citations', citations });
  emit({
    kind: 'done',
    usage: { inputTokens: total.inputTokens ?? 0, outputTokens: total.outputTokens ?? 0 },
  });
}
