/**
 * runKnowledgeAgent on Claude via Amazon Bedrock.
 *
 * A manual streaming tool loop: each round streams Claude's text to the
 * caller, runs any requested tools here (knowledge search, page fetch, graph
 * lookup, tenant MCP tools) and feeds every result back in one user turn.
 * Emits the same AgentEvent stream as the Foundry runtime, so the routes and
 * UI don't know which cloud answered.
 *
 * History is client-held, as on Azure: nothing persists between turns.
 */
import Anthropic, { BetaFallbackState } from '@anthropic-ai/sdk';
import { claudeModel, getClaudeClient, supportsEagerInputStreaming } from '../clients/claude.js';
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

type BetaTool = Anthropic.Beta.BetaTool;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;

/** Consecutive unparseable tool inputs tolerated before giving up on a turn. */
const MAX_JSON_RETRIES = 2;

interface FunctionToolShape {
  function: { name: string; description?: string; parameters?: unknown };
}

/** The same three knowledge tools the Foundry agent carries, in Claude's shape. */
function knowledgeTools(eager: boolean): BetaTool[] {
  return (AGENT_FUNCTION_TOOLS as unknown as FunctionToolShape[]).map(({ function: fn }) => ({
    name: fn.name,
    description: fn.description ?? '',
    input_schema: fn.parameters as Anthropic.Beta.BetaTool.InputSchema,
    ...(eager && { eager_input_streaming: true }),
  }));
}

interface McpTools {
  tools: BetaTool[];
  route: Map<string, { ref: McpServerRef; tool: string }>;
  labels: string[];
}

/** MCP tools become `mcp__<label>__<tool>`; the route map undoes the naming. */
async function buildMcpTools(servers: McpServerRef[], eager: boolean): Promise<McpTools> {
  const toolset: McpTools = { tools: [], route: new Map(), labels: [] };
  for (const ref of servers) {
    try {
      for (const t of await listMcpTools(ref)) {
        const name = `mcp__${ref.label}__${t.name}`;
        if (name.length > 64) {
          console.warn(`mcp tool name too long, skipped: ${name}`);
          continue;
        }
        toolset.tools.push({
          name,
          description: t.description.slice(0, 512),
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
          ...(eager && { eager_input_streaming: true }),
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

/** Claude needs a user turn first; client history may open with a greeting. */
function toClaudeHistory(messages: AgentChatMessage[]): BetaMessageParam[] {
  const history = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
  while (history.length > 0 && history[0]!.role !== 'user') history.shift();
  return history;
}

function effort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  const value = process.env.HORUS_CLAUDE_EFFORT;
  return value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : undefined;
}

export async function runKnowledgeAgentOnClaude(params: RunAgentParams): Promise<void> {
  const { emit, signal } = params;
  const client = getClaudeClient();
  const model = claudeModel(params.model ?? 'fast');
  const eager = supportsEagerInputStreaming(model);

  const scope: ToolScope = {
    indexName: params.indexName,
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    topK: params.topK ?? 8,
    ...(params.sourceIds && { sourceIds: params.sourceIds }),
  };
  const registry = new CitationRegistry();
  let toolCallBudget = MAX_TOOL_CALLS;

  const mcp = params.mcpServers?.length ? await buildMcpTools(params.mcpServers, eager) : null;
  const tools: BetaTool[] = [...knowledgeTools(eager), ...(mcp?.tools ?? [])];

  // Stable rules first, behind a cache breakpoint (Bedrock takes explicit
  // breakpoints only); the per-turn source list and persona follow it.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text:
        (await describeSources(scope)) +
        mcpNote(mcp?.labels ?? []) +
        personaNote(params.persona, params.personaName),
    },
  ];

  const messages = toClaudeHistory(params.messages);
  if (messages.length === 0) {
    emit({ kind: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
    return;
  }

  // Pins later rounds to whichever model accepted, if a refusal fell back.
  const fallbackState = new BetaFallbackState();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const level = effort();
  let jsonRetries = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 16000,
        system,
        tools,
        messages,
        // Last round: answer with what has been gathered, no more tools.
        ...(round === MAX_TOOL_ROUNDS && { tool_choice: { type: 'none' as const } }),
        ...(level && { output_config: { effort: level } }),
      },
      { signal, fallbackState },
    );
    stream.on('text', (delta) => emit({ kind: 'token', text: delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming a tool input can arrive as unparseable
      // JSON; re-issue that turn. API errors propagate to the route.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= MAX_JSON_RETRIES) throw err;
      round--;
      continue;
    }

    usage.inputTokens +=
      message.usage.input_tokens +
      (message.usage.cache_read_input_tokens ?? 0) +
      (message.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += message.usage.output_tokens;

    if (message.stop_reason === 'refusal') {
      emit({ kind: 'token', text: "\n\nI can't help with that request." });
      break;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );
    if (toolUses.length === 0) break;
    // A tool input cut off at max_tokens can parse as a valid partial
    // object; never run tools on a truncated turn.
    if (message.stop_reason === 'max_tokens') break;

    messages.push({ role: 'assistant', content: message.content });

    const results: BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      toolCallBudget--;
      const input = (call.input ?? {}) as Record<string, unknown>;
      const mcpTarget = mcp?.route.get(call.name);
      let result: string;

      if (toolCallBudget < 0) {
        result = 'Tool budget exhausted — answer now with what you have.';
      } else if (call.name === 'search_knowledge' && typeof input.query === 'string') {
        emit({ kind: 'tool', name: 'search_knowledge', status: 'start', detail: input.query });
        result = await executeSearchKnowledge(scope, registry, input.query);
        emit({ kind: 'tool', name: 'search_knowledge', status: 'end' });
      } else if (call.name === 'fetch_page' && typeof input.url === 'string') {
        emit({ kind: 'tool', name: 'fetch_page', status: 'start', detail: input.url });
        result = await executeFetchPage(registry, input.url);
        emit({ kind: 'tool', name: 'fetch_page', status: 'end' });
      } else if (call.name === 'graph_lookup' && typeof input.entity === 'string') {
        emit({ kind: 'tool', name: 'graph_lookup', status: 'start', detail: input.entity });
        result = await executeGraphLookup(scope, registry, input.entity);
        emit({ kind: 'tool', name: 'graph_lookup', status: 'end' });
      } else if (mcpTarget) {
        const display = `${mcpTarget.ref.label}:${mcpTarget.tool}`;
        emit({ kind: 'tool', name: display, status: 'start' });
        result = await callMcpTool(mcpTarget.ref, mcpTarget.tool, input);
        emit({ kind: 'tool', name: display, status: 'end' });
      } else {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Unknown tool or invalid arguments for "${call.name}".`,
        });
        continue;
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: result });
    }
    // All results in one user turn — splitting them discourages parallel calls.
    messages.push({ role: 'user', content: results });
  }

  const citations = registry.all();
  if (citations.length > 0) emit({ kind: 'citations', citations });
  emit({ kind: 'done', usage });
}
