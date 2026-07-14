/**
 * Server-Sent Events response helper. The handler receives a `send` that
 * writes one JSON event per SSE frame; thrown errors become a final
 * `{ kind: "error" }` event instead of a broken stream.
 */

export type SseSend = (data: unknown) => void;

export function sseResponse(handler: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send: SseSend = (data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client went away mid-write
        }
      };

      try {
        await handler(send);
      } catch (err) {
        send({ kind: 'error', message: err instanceof Error ? err.message : 'Request failed' });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
