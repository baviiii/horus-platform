/**
 * Photo evidence analysis — gpt-4o vision over incident photos.
 *
 * A field worker's photo (injury site, damaged equipment, medication
 * packaging) is often the highest-signal evidence they have. We turn it into
 * objective text so it can be cited like any other evidence. The prompt is
 * deliberately conservative: describe, never diagnose, never identify.
 */
import { getOpenAIClient, MODELS } from '../clients/openai.js';

export interface PhotoAnalysis {
  description: string;
  /** Verbatim text visible in the image (labels, signage), or null. */
  extractedText: string | null;
  hazards: string[];
  model: string;
}

const SYSTEM = `You describe photos attached as evidence to a disability-services incident report.

Rules:
- Objective and factual. No speculation about causes, fault, or intent.
- Note visible hazards, injuries (plain descriptive terms — never a diagnosis), property damage, medication packaging, equipment state.
- Never attempt to identify people. Refer to them generically ("an adult", "a person's forearm").
- Transcribe clearly visible text (labels, signs, documents) verbatim.

Return ONLY JSON: { "description": string (max 120 words), "extracted_text": string | null, "hazards": string[] (max 5 short phrases) }`;

export interface AnalyzePhotoParams {
  data: Uint8Array;
  mimeType: string;
  /** Optional reporter context, e.g. "photo of the bathroom where the fall happened". */
  hint?: string;
}

export async function analyzeIncidentPhoto(params: AnalyzePhotoParams): Promise<PhotoAnalysis> {
  const client = getOpenAIClient();
  const dataUrl = `data:${params.mimeType};base64,${Buffer.from(params.data).toString('base64')}`;

  const completion = await client.chat.completions.create({
    model: MODELS.completion,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: params.hint?.trim() || 'Analyze this incident evidence photo.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 800,
  });

  const content = completion.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('Photo analysis returned an empty response');

  let raw: { description?: unknown; extracted_text?: unknown; hazards?: unknown };
  try {
    raw = JSON.parse(content) as typeof raw;
  } catch {
    // Degrade to plain description rather than failing the upload.
    raw = { description: content.slice(0, 800), extracted_text: null, hazards: [] };
  }

  return {
    description:
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim().slice(0, 1200)
        : 'No description produced.',
    extractedText:
      typeof raw.extracted_text === 'string' && raw.extracted_text.trim()
        ? raw.extracted_text.trim().slice(0, 1200)
        : null,
    hazards: Array.isArray(raw.hazards)
      ? raw.hazards.filter((h): h is string => typeof h === 'string').slice(0, 5)
      : [],
    model: completion.model ?? MODELS.completion,
  };
}

/** Flatten an analysis into citable evidence text. */
export function photoAnalysisToText(analysis: PhotoAnalysis): string {
  const parts = [`Photo analysis: ${analysis.description}`];
  if (analysis.extractedText) parts.push(`Visible text: "${analysis.extractedText}"`);
  if (analysis.hazards.length > 0) parts.push(`Noted hazards: ${analysis.hazards.join('; ')}.`);
  return parts.join('\n');
}
