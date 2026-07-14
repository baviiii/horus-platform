import { z } from 'zod';
import { countSessionChunks, ingestPdf, listSessionSources } from '@horus/core/knowledge';
import { PLAYGROUND } from '../../_lib/config';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';
import { sseResponse } from '../../_lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SessionSchema = z.string().uuid();

export async function POST(req: Request) {
  const rate = checkRateLimit('ingest', clientIp(req), PLAYGROUND.rate.ingestPerHour);
  if (!rate.ok) return rateLimitResponse(rate);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Body must be multipart/form-data' }, { status: 400 });
  }

  const sessionParsed = SessionSchema.safeParse(form.get('sessionId'));
  if (!sessionParsed.success) {
    return Response.json({ error: 'sessionId must be a UUID' }, { status: 400 });
  }
  const sessionId = sessionParsed.data;

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Attach a PDF as the "file" field' }, { status: 400 });
  }
  const filename = file.name.split(/[\\/]/).pop()?.slice(0, 120) ?? 'document.pdf';
  if (!/\.pdf$/i.test(filename)) {
    return Response.json({ error: 'Only PDF files are supported' }, { status: 400 });
  }
  if (file.size > PLAYGROUND.maxPdfBytes) {
    return Response.json(
      { error: `PDF too large — limit is ${Math.round(PLAYGROUND.maxPdfBytes / 1024 / 1024)}MB` },
      { status: 400 },
    );
  }

  const [sources, chunkCount] = await Promise.all([
    listSessionSources(PLAYGROUND.indexName, PLAYGROUND.tenantId, sessionId).catch(() => []),
    countSessionChunks(PLAYGROUND.indexName, PLAYGROUND.tenantId, sessionId).catch(() => 0),
  ]);
  if (sources.length >= PLAYGROUND.maxSourcesPerSession) {
    return Response.json(
      {
        error: `Session source limit reached (${PLAYGROUND.maxSourcesPerSession}). Reset the session to start over.`,
      },
      { status: 400 },
    );
  }
  if (chunkCount >= PLAYGROUND.maxChunksPerSession) {
    return Response.json(
      { error: 'Session knowledge limit reached. Reset the session to start over.' },
      { status: 400 },
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());

  return sseResponse(async (send) => {
    await ingestPdf({
      indexName: PLAYGROUND.indexName,
      tenantId: PLAYGROUND.tenantId,
      sessionId,
      filename,
      data,
      maxChunks: Math.min(
        PLAYGROUND.maxChunksPerIngest,
        PLAYGROUND.maxChunksPerSession - chunkCount,
      ),
      emit: send,
    });
  });
}
