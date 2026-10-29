/**
 * JSON-only generation through the AI SDK, on any model provider.
 *
 * With a JSON Schema the answer is validated against it (Output.object);
 * without one any JSON object is accepted (Output.json). The AI SDK picks how
 * each model produces it (for Claude on Bedrock, a forced `json` tool).
 */
import { generateText, jsonSchema, Output, type ModelMessage } from 'ai';
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

export async function aiSdkJson(params: AiSdkJsonParams): Promise<AiSdkJsonResult> {
  const id = modelId(params.tier);
  const schema = params.schema?.type === 'object' ? params.schema : undefined;

  const result = await generateText({
    model: languageModel(params.tier),
    instructions: params.system,
    messages: params.messages,
    output: schema ? Output.object({ schema: jsonSchema(schema) }) : Output.json(),
    // 8k fits every model we use; callers that need more say so.
    maxOutputTokens: params.maxTokens ?? 8192,
    ...(params.signal && { abortSignal: params.signal }),
  });

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
