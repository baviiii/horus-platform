/**
 * JSON-only generation through the AI SDK, on any model provider.
 *
 * The answer always goes through Output.object, with the caller's JSON Schema
 * or, without one, any JSON object. That makes the AI SDK force structured
 * output (for Claude on Bedrock, a forced `json` tool). Output.json() does
 * not: it parses free text, and models wrap JSON in ```json fences there.
 * If a model still answers in text, the JSON is pulled out of it.
 */
import { generateText, jsonSchema, NoObjectGeneratedError, Output, type ModelMessage } from 'ai';
import { languageModel, modelId, type ModelTier } from '../clients/models.js';

export interface AiSdkJsonParams {
  tier: ModelTier;
  system: string;
  messages: ModelMessage[];
  /** JSON Schema for the answer object; any JSON object when absent. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiSdkJsonResult {
  /** The answer as a JSON string. */
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const ANY_OBJECT = { type: 'object', additionalProperties: true };

/** Last resort when a model wrote its JSON as text: fences, preamble and all. */
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

export async function aiSdkJson(params: AiSdkJsonParams): Promise<AiSdkJsonResult> {
  const id = modelId(params.tier);
  const schema = params.schema?.type === 'object' ? params.schema : ANY_OBJECT;

  let result;
  try {
    result = await generateText({
      model: languageModel(params.tier),
      instructions: params.system,
      messages: params.messages,
      output: Output.object({ schema: jsonSchema(schema) }),
      // 8k fits every model we use; callers that need more say so.
      maxOutputTokens: params.maxTokens ?? 8192,
      ...(params.signal && { abortSignal: params.signal }),
    });
  } catch (err) {
    if (!NoObjectGeneratedError.isInstance(err)) throw err;
    const json = err.text ? jsonFromText(err.text) : null;
    if (!json) throw err;
    return {
      content: json,
      model: id,
      usage: {
        inputTokens: err.usage?.inputTokens ?? 0,
        outputTokens: err.usage?.outputTokens ?? 0,
      },
    };
  }

  if (result.finishReason === 'content-filter') {
    throw new Error('The model declined this request.');
  }
  if (result.finishReason === 'length') {
    throw new Error('The model ran out of output tokens before finishing its answer.');
  }

  return {
    content: JSON.stringify(result.output),
    model: id,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
}
