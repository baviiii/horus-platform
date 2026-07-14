/**
 * infer() — Horus's single, domain-agnostic structured-generation primitive.
 *
 * This is the one door every model call in the platform goes through. A caller
 * (e.g. the interview-coach MCP) hands over a system prompt + messages and gets
 * back the model's reply as a JSON string. We force JSON-mode output; the caller
 * owns the schema (it lives in their prompt) and parses the result.
 *
 * `model: "fast" | "deep"` is a capability tier, not a vendor model id — we map
 * it to a concrete Azure deployment here so callers stay vendor-agnostic.
 */
import type OpenAI from 'openai';
import { getOpenAIClient, MODELS } from '../clients/openai.js';

export type ModelTier = 'fast' | 'deep';

export interface InferMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface InferParams {
  /** Routing + telemetry key, e.g. "interview.evaluate_answer". */
  task: string;
  /** The expert system prompt (the caller's domain knowledge). */
  system: string;
  messages: InferMessage[];
  model?: ModelTier;
  temperature?: number;
  maxTokens?: number;
  /** Optional JSON Schema. Reserved for a future strict structured-output mode. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  /** Per-caller cost attribution. */
  userRef?: string;
  tenant?: string;
}

export interface InferResult {
  /** The model's reply as a JSON string. The caller parses this. */
  content: string;
  /** Concrete model/deployment that served the request. */
  model: string;
  cached: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

/** Map the capability tier to a concrete Azure deployment name. */
export function resolveDeployment(tier: ModelTier): string {
  if (tier === 'deep') return process.env.AZURE_OPENAI_DEEP_MODEL ?? MODELS.completion;
  return process.env.AZURE_OPENAI_FAST_MODEL ?? MODELS.completion;
}

const mentionsJson = (s: string): boolean => /json/i.test(s);

export async function infer(params: InferParams): Promise<InferResult> {
  const client = getOpenAIClient();
  const deployment = resolveDeployment(params.model ?? 'fast');

  // json_object mode requires the word "json" somewhere in the prompt. Our
  // callers always say "Return ONLY JSON", but guard the general case.
  const system =
    mentionsJson(params.system) || params.messages.some((m) => mentionsJson(m.content))
      ? params.system
      : `${params.system}\n\nRespond with a single valid JSON object.`;

  const messages = [
    { role: 'system', content: system },
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

  const completion = await client.chat.completions.create({
    model: deployment,
    messages,
    response_format: { type: 'json_object' },
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 4000,
  });

  const content = completion.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('Model returned an empty response');

  return {
    content,
    model: completion.model ?? deployment,
    cached: false,
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
