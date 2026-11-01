/**
 * infer() — Horus's single, domain-agnostic structured-generation primitive.
 *
 * This is the one door every model call in the platform goes through. A caller
 * (e.g. the interview-coach MCP) hands over a system prompt + messages and gets
 * back the model's reply as a JSON string. We force JSON-mode output; the caller
 * owns the schema (it lives in their prompt) and parses the result.
 *
 * `model: "fast" | "deep"` is a capability tier, not a vendor model id — we map
 * it to a concrete Azure deployment or configured model here so callers stay
 * vendor-agnostic.
 */
import type { ModelMessage } from 'ai';
import type OpenAI from 'openai';
import { getOpenAIClient, MODELS } from '../clients/openai.js';
import { aiProvider, assertAiAvailable } from '../provider.js';
import { aiSdkJson } from './ai-sdk-json.js';

export type ModelTier = 'fast' | 'deep';

/** The image formats Claude and GPT-4o both read. */
export type InferImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** One piece of a user message: text, or an image (base64, no data: prefix). */
export type InferContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mediaType: InferImageType };

export interface InferMessage {
  role: 'user' | 'assistant' | 'system';
  /** Text, or for a user turn, text and images — e.g. the pages of a résumé. */
  content: string | InferContentPart[];
}

/** The text of a message, for the places that only take text. */
function textOf(content: InferMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
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
  /** Optional JSON Schema the answer must fill (on AWS; Azure takes any JSON object). */
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

/**
 * System-role messages fold into the system prompt, and a leading assistant
 * turn gets a neutral user turn in front of it: Bedrock conversations must
 * open on a user turn.
 */
async function inferWithAiSdk(params: InferParams): Promise<InferResult> {
  const systemExtras = params.messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content));
  const messages: ModelMessage[] = params.messages
    .filter((m) => m.role !== 'system')
    .map((m): ModelMessage => {
      if (m.role === 'assistant' || typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: textOf(m.content) };
      }
      return {
        role: 'user',
        content: m.content.map((p) =>
          p.type === 'text'
            ? { type: 'text' as const, text: p.text }
            : { type: 'image' as const, image: p.image, mediaType: p.mediaType },
        ),
      };
    });
  if (messages[0]?.role !== 'user') {
    messages.unshift({ role: 'user', content: 'Begin.' });
  }

  const result = await aiSdkJson({
    tier: params.model ?? 'fast',
    system: [params.system, ...systemExtras].join('\n\n'),
    messages,
    ...(params.schema && { schema: params.schema }),
    ...(params.maxTokens && { maxTokens: params.maxTokens }),
  });
  return { ...result, cached: false };
}

export async function infer(params: InferParams): Promise<InferResult> {
  assertAiAvailable();
  if (aiProvider() === 'aws') return inferWithAiSdk(params);

  const client = getOpenAIClient();
  const deployment = resolveDeployment(params.model ?? 'fast');

  // json_object mode requires the word "json" somewhere in the prompt. Our
  // callers always say "Return ONLY JSON", but guard the general case.
  const system =
    mentionsJson(params.system) || params.messages.some((m) => mentionsJson(textOf(m.content)))
      ? params.system
      : `${params.system}\n\nRespond with a single valid JSON object.`;

  const messages = [
    { role: 'system', content: system },
    ...params.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) =>
              p.type === 'text'
                ? { type: 'text', text: p.text }
                : {
                    type: 'image_url',
                    image_url: { url: `data:${p.mediaType};base64,${p.image}` },
                  },
            ),
    })),
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
