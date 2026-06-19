import { describe, it, expect } from 'vitest';
import { refusalResponse } from './refusal-response';

describe('refusalResponse', () => {
  it('returns a JSON response when not streaming', async () => {
    const r = refusalResponse({
      stream: false,
      sseFormat: false,
      executionId: 'e1',
      sessionId: 's1',
      message: 'Blocked by guardrails.',
    });
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('x-execution-id')).toBe('e1');
    expect(r.headers.get('x-session-id')).toBe('s1');
    const body = await r.json();
    expect(body).toEqual({ id: 'e1', content: 'Blocked by guardrails.', blocked: true });
  });

  it('returns an SSE response (text/event-stream) when sseFormat', async () => {
    const r = refusalResponse({
      stream: true,
      sseFormat: true,
      executionId: 'e1',
      sessionId: 's2',
      message: 'Blocked by guardrails.',
    });
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    expect(r.headers.get('x-execution-id')).toBe('e1');
    expect(r.headers.get('x-session-id')).toBe('s2');
    const text = await r.text();
    // StreamEvent frames: part_start (text) -> token -> part_complete -> done
    expect(text).toContain('"type":"part_start"');
    expect(text).toContain('"type":"token"');
    expect(text).toContain('Blocked by guardrails.');
    expect(text).toContain('"type":"part_complete"');
    expect(text).toContain('"type":"done"');
  });

  it('returns a UI message stream response (AI SDK protocol) when stream && !sseFormat', async () => {
    const r = refusalResponse({
      stream: true,
      sseFormat: false,
      executionId: 'e1',
      sessionId: 's3',
      message: 'Blocked by guardrails.',
    });
    // The AI SDK UI message stream is served as text/event-stream with the
    // x-vercel-ai-ui-message-stream marker header.
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    expect(r.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    expect(r.headers.get('x-execution-id')).toBe('e1');
    expect(r.headers.get('x-session-id')).toBe('s3');
    const text = await r.text();
    // AI SDK UI message stream chunks: text-start -> text-delta (delta field) -> text-end -> finish
    expect(text).toContain('"type":"text-start"');
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain('"delta":"Blocked by guardrails."');
    expect(text).toContain('"type":"text-end"');
    expect(text).toContain('"type":"finish"');
  });

  it('omits x-session-id when sessionId is undefined', async () => {
    const r = refusalResponse({
      stream: false,
      sseFormat: false,
      executionId: 'e1',
      sessionId: undefined,
      message: 'no',
    });
    expect(r.headers.get('x-session-id')).toBeNull();
  });
});