/**
 * Voice session definition for the GA Realtime API.
 *
 * The whole session config — model, prompt, tools, VAD, transcription — is
 * baked into the ephemeral-key mint (`/openai/v1/realtime/client_secrets`),
 * so the browser gets a preconfigured full-duplex agent and never sees a
 * secret or a system prompt. Function calls arrive on the WebRTC data
 * channel and are bridged back to our tool executors over HTTP.
 */
import { listSessionSources } from '../knowledge/store.js';

const VOICE = 'marin';

const VOICE_PROMPT = `You are a spoken knowledge agent powered by Horus, in a live voice conversation. The user has connected websites and documents to this session; that knowledge base is your source of truth.

Rules:
- Before answering any factual question, call search_knowledge with a well-phrased query. Re-search with different terms if the first pass misses.
- When the user says "this website", "the document", "the company", or similar, they mean the connected sources listed below. NEVER ask which source they mean — search first and answer from what comes back.
- If the knowledge base has nothing relevant, say so plainly and suggest what the user could connect — never invent an answer.
- This is speech: keep answers short and conversational. One or two sentences first, detail only if asked. Never read out URLs, citation numbers, or markdown.
- It is fine to briefly say you are looking something up when you call a tool.`;

/** GA realtime function-tool format (flat, unlike chat completions). */
const REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'search_knowledge',
    description:
      "Search the user's connected knowledge base (crawled websites + uploaded PDFs). Call this before answering any factual question.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — rephrase the user question into good search terms.',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'fetch_page',
    description:
      'Fetch a live web page and return its readable text. Use only when the user mentions a specific page not in the knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
      },
      required: ['url'],
    },
  },
] as const;

export interface VoiceSessionScope {
  indexName: string;
  tenantId: string;
  sessionId: string;
}

/**
 * A listen-only session for spoken answers (Faircopy's interview practice,
 * via the interview-coach MCP). The candidate speaks; the transcript streams
 * back; the model never replies on its own (`create_response: false`), so the
 * same input transcription the knowledge agent already uses becomes a
 * dictation channel. The browser may still send `response.create` to have the
 * interviewer read a question aloud — the instructions pin it to exactly that.
 */
export function buildListenSessionConfig(deployment: string): Record<string, unknown> {
  return {
    type: 'realtime',
    model: deployment,
    instructions:
      "You are an interviewer's voice in a practice interview. Speak only when asked to read a question aloud: read it exactly as written, naturally and at an even pace. Never answer, comment on, or evaluate anything the candidate says.",
    audio: {
      input: {
        transcription: { model: 'whisper-1', language: 'en' },
        // Long pauses are normal mid-answer; don't cut a sentence in two.
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          interrupt_response: false,
          silence_duration_ms: 1200,
        },
      },
      output: { voice: VOICE },
    },
  };
}

/** The `session` payload for the realtime client_secrets mint call. */
export async function buildVoiceSessionConfig(
  scope: VoiceSessionScope,
  deployment: string,
): Promise<Record<string, unknown>> {
  let sourcesNote =
    'Connected sources: unavailable — use search_knowledge to discover what is indexed.';
  try {
    const sources = await listSessionSources(scope.indexName, scope.tenantId, scope.sessionId);
    sourcesNote =
      sources.length === 0
        ? 'Connected sources: none yet. If asked a factual question, try search_knowledge once, then suggest connecting a website or PDF.'
        : `Connected sources right now:\n${sources
            .map(
              (s) =>
                `- ${s.title || s.sourceUrl} (${s.sourceType === 'url' ? s.sourceUrl : 'uploaded PDF'}, ${s.chunkCount} chunks)`,
            )
            .join('\n')}`;
  } catch {
    /* keep fallback note */
  }

  return {
    type: 'realtime',
    model: deployment,
    instructions: `${VOICE_PROMPT}\n\n${sourcesNote}`,
    tools: REALTIME_TOOLS,
    tool_choice: 'auto',
    audio: {
      input: {
        transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad' },
      },
      output: { voice: VOICE },
    },
  };
}
