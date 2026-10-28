/**
 * JSON-only generation on Claude via Bedrock.
 *
 * Bedrock's Messages endpoint has no structured-outputs mode, so the answer
 * comes back as the input of a `respond` tool the model is made to call.
 * Forcing a tool requires thinking off, which Opus 5 allows at default
 * effort. Models that reject forced tool choice get `auto` plus an
 * instruction, with a text-JSON fallback if they answer in prose anyway.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  claudeModel,
  getClaudeClient,
  supportsForcedToolChoice,
  type ClaudeTier,
} from '../clients/claude.js';

const RESPOND_TOOL = 'respond';

export interface ClaudeJsonParams {
  tier: ClaudeTier;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  /** JSON Schema for the answer object; a generic object when absent. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ClaudeJsonResult {
  /** The answer as a JSON string. */
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

function inputSchema(
  schema: Record<string, unknown> | undefined,
): Anthropic.Beta.BetaTool.InputSchema {
  if (schema && schema.type === 'object') return schema as Anthropic.Beta.BetaTool.InputSchema;
  return { type: 'object', additionalProperties: true };
}

/** Last resort when the model wrote its JSON as text instead of calling the tool. */
function jsonFromText(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function claudeJson(params: ClaudeJsonParams): Promise<ClaudeJsonResult> {
  const model = claudeModel(params.tier);
  const forced = supportsForcedToolChoice(model);

  const response = await getClaudeClient().beta.messages.create(
    {
      model,
      max_tokens: params.maxTokens ?? 16000,
      system: `${params.system}\n\nAlways give your final answer by calling the ${RESPOND_TOOL} tool with the complete JSON object.`,
      messages: params.messages,
      tools: [
        {
          name: RESPOND_TOOL,
          description: 'Return the final answer as a single JSON object.',
          input_schema: inputSchema(params.schema),
        },
      ],
      ...(forced
        ? {
            tool_choice: { type: 'tool' as const, name: RESPOND_TOOL },
            thinking: { type: 'disabled' as const },
          }
        : { tool_choice: { type: 'auto' as const } }),
    },
    { signal: params.signal },
  );

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The model ran out of output tokens before finishing its answer.');
  }

  let content: string | null = null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === RESPOND_TOOL) {
      content = JSON.stringify(block.input);
      break;
    }
  }
  if (content === null) {
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    content = jsonFromText(text);
  }
  if (!content) throw new Error('Model returned no JSON answer');

  return {
    content,
    model: response.model ?? model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
