import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
import { toSseFrame, type StreamEvent } from '@chatbot/ai';

/**
 * Build the format-appropriate `Response` for an input-guardrail block refusal,
 * matching each of the three response branches in the inference route:
 *
 *  1. SSE branch (`stream && sseFormat`) — `PartStreamEmitter` over `fullStream`,
 *     serialized with `toSseFrame(event: StreamEvent)`. `StreamEvent.type` is one of
 *     `part_start | token | thinking_step | part_complete | done | error` (see
 *     `libs/ai/src/stream-events.ts`). We mirror a minimal text turn:
 *     `part_start` (text) → `token` (content=message) → `part_complete` → `done`.
 *
 *  2. UI message stream branch (`stream && !sseFormat`) — the route calls
 *     `result.toUIMessageStreamResponse(...)` (the AI SDK UI message stream
 *     protocol, served as SSE with the `x-vercel-ai-ui-message-stream` marker).
 *     We build the equivalent with the AI SDK's own helpers
 *     `createUIMessageStream` + `createUIMessageStreamResponse`, emitting one
 *     text part (`text-start` → `text-delta { delta }` → `text-end`) then
 *     `finish`. This is the exact chunk shape the SDK widget consumes (verified
 *     against `UIMessageChunk` in `node_modules/ai/dist/index.d.ts`: the text
 *     delta field is `delta`, NOT `textDelta`).
 *
 *  3. JSON branch (non-stream) — `{ id, content, blocked: true }` matching the
 *     route's success JSON shape (`{ id, content, usage, cacheHit }`).
 *
 * Framework-agnostic: lives in `libs/guardrails/src/integration/` so it can be
 * unit-tested under the guardrails Vitest config (web-ui has none). `Response`,
 * `ReadableStream`, `TextEncoder` are globals under bun/node 18+.
 */
export function refusalResponse(args: {
  stream: boolean;
  sseFormat: boolean;
  executionId: string;
  sessionId?: string;
  message: string;
}): Response {
  const { stream, sseFormat, executionId, sessionId, message } = args;

  // ─── UI message stream (AI SDK protocol) ──────────────────────────────
  if (stream && !sseFormat) {
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => {
        const partId = executionId;
        writer.write({ type: 'text-start', id: partId } satisfies UIMessageChunk);
        writer.write({ type: 'text-delta', id: partId, delta: message } satisfies UIMessageChunk);
        writer.write({ type: 'text-end', id: partId } satisfies UIMessageChunk);
        writer.write({ type: 'finish', finishReason: 'stop' } satisfies UIMessageChunk);
      },
    });
    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: {
        'x-execution-id': executionId,
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
      },
    });
  }

  // ─── SSE (PartStreamEmitter / StreamEvent protocol) ───────────────────
  if (stream && sseFormat) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const partIndex = 0;
        controller.enqueue(
          encoder.encode(
            toSseFrame({
              type: 'part_start',
              messageId: executionId,
              partIndex,
              partType: 'text',
              part: { type: 'text', text: '' },
            } satisfies StreamEvent),
          ),
        );
        controller.enqueue(
          encoder.encode(
            toSseFrame({
              type: 'token',
              messageId: executionId,
              partIndex,
              content: message,
            } satisfies StreamEvent),
          ),
        );
        controller.enqueue(
          encoder.encode(
            toSseFrame({
              type: 'part_complete',
              messageId: executionId,
              partIndex,
              part: { type: 'text', text: message },
            } satisfies StreamEvent),
          ),
        );
        controller.enqueue(
          encoder.encode(
            toSseFrame({ type: 'done', messageId: executionId } satisfies StreamEvent),
          ),
        );
        controller.close();
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Execution-Id': executionId,
        ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      },
    });
  }

  // ─── JSON ─────────────────────────────────────────────────────────────
  return new Response(JSON.stringify({ id: executionId, content: message, blocked: true }), {
    headers: {
      'Content-Type': 'application/json',
      'x-execution-id': executionId,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
  });
}