import { describe, it, expect, vi } from 'vitest';
import { createGuardrailsMiddleware } from './middleware';
import { defaultGuardrailsConfig } from '../config/schema';
import { ReadableStream } from 'stream/web';

vi.mock('../judge/llm-judge', () => ({
  judgeText: vi.fn(async () => ({ violated: false, confidence: 0 })),
}));
vi.mock('@chatbot/shared', async () => {
  const actual = await vi.importActual('@chatbot/shared');
  return { ...(actual as any), createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) };
});

function makeStream(parts: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); },
  });
}

const ctx = (config = defaultGuardrailsConfig()) => ({ config, tenantId: 't1', agentId: 'a1' });

describe('createGuardrailsMiddleware', () => {
  it('masks an email in a text-delta in-flight', async () => {
    const cfg = defaultGuardrailsConfig(); cfg.enabled = true; cfg.output.piiRedaction.enabled = true;
    const mw = createGuardrailsMiddleware(ctx(cfg));
    const result = await mw.wrapStream!({
      doStream: async () => ({ stream: makeStream([{ type: 'text-delta', id: '1', delta: 'mail a@b.com' }]) } as any),
      params: {} as any, model: {} as any,
    } as any);
    const out: any[] = [];
    for await (const p of (result as any).stream) out.push(p);
    const text = out.filter((p) => p.type === 'text-delta').map((p) => p.delta).join('');
    expect(text).toBe('mail [EMAIL]');
  });

  it('passes non-text parts through unchanged', async () => {
    const cfg = defaultGuardrailsConfig(); cfg.enabled = true; cfg.output.piiRedaction.enabled = true;
    const mw = createGuardrailsMiddleware(ctx(cfg));
    const result = await mw.wrapStream!({
      doStream: async () => ({ stream: makeStream([{ type: 'tool-call', id: 't1', toolName: 'x', args: {} }]) } as any),
      params: {} as any, model: {} as any,
    } as any);
    const out: any[] = [];
    for await (const p of (result as any).stream) out.push(p);
    expect(out.find((p) => p.type === 'tool-call')).toBeTruthy();
  });

  it('fails open (streams unchanged) on mask error', async () => {
    const cfg = defaultGuardrailsConfig(); cfg.enabled = true;
    const mw = createGuardrailsMiddleware(ctx(cfg));
    const result = await mw.wrapStream!({
      doStream: async () => ({ stream: makeStream([{ type: 'text-delta', id: '1', delta: 'hello' }]) } as any),
      params: {} as any, model: {} as any,
    } as any);
    const out: any[] = [];
    for await (const p of (result as any).stream) out.push(p);
    expect(out.find((p) => p.type === 'text-delta').delta).toBe('hello');
  });

  // Regression for the playground crash "text part guardrails-flush not found":
  // the real streamText/Bedrock path emits the full part protocol (text-start ->
  // text-delta* -> text-end -> finish), often with a tool-call interleaved. The
  // held-back tail must flush BEFORE text-end, reusing the text part's own id —
  // never a fabricated id like 'guardrails-flush' (which the SDK rejects because
  // no text-start opened it).
  it('flushes the held tail before text-end using the text part id (part protocol)', async () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    cfg.output.piiRedaction.enabled = true;
    const mw = createGuardrailsMiddleware(ctx(cfg));
    const result = await mw.wrapStream!({
      doStream: async () => ({
        stream: makeStream([
          { type: 'text-start', id: 'txt-1' },
          { type: 'text-delta', id: 'txt-1', delta: 'reply to jane@example.com' },
          { type: 'tool-call', id: 'call-1', toolName: 'web_fetch', args: { url: 'x' } },
          { type: 'text-end', id: 'txt-1' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
        ]),
      } as any),
      params: {} as any, model: {} as any,
    } as any);
    const out: any[] = [];
    for await (const p of (result as any).stream) out.push(p);

    // No text-delta may carry a fabricated id — every delta must reference txt-1.
    const textDeltas = out.filter((p) => p.type === 'text-delta');
    expect(textDeltas.every((p) => p.id === 'txt-1')).toBe(true);
    expect(textDeltas.some((p) => p.id === 'guardrails-flush')).toBe(false);

    // The held tail (< ROLLING_BUFFER chars) flushes at text-end, before the text-end part.
    const textEndIndex = out.findIndex((p) => p.type === 'text-end');
    const lastDeltaIndex = out.map((p) => p.type).lastIndexOf('text-delta');
    expect(textEndIndex).toBeGreaterThan(-1);
    expect(lastDeltaIndex).toBeGreaterThan(-1);
    expect(lastDeltaIndex).toBeLessThan(textEndIndex);

    // Masking still applies across the held tail.
    const text = textDeltas.map((p) => p.delta).join('');
    expect(text).toContain('[EMAIL]');
    expect(text).not.toContain('jane@example.com');

    // Non-text parts pass through untouched and in order.
    expect(out.find((p) => p.type === 'tool-call')?.toolName).toBe('web_fetch');
    expect(out.find((p) => p.type === 'finish')).toBeTruthy();
    expect(out.find((p) => p.type === 'text-start')?.id).toBe('txt-1');
  });

  it('bypasses the transform when no output rules or judge are active', async () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true; // enabled but all output rules off...
    cfg.judge.enabled = false; // ...and judge off -> nothing to do -> bypass
    const mw = createGuardrailsMiddleware(ctx(cfg));
    const source = makeStream([{ type: 'text-delta', id: '1', delta: 'hello' }]);
    const result = await mw.wrapStream!({
      doStream: async () => ({ stream: source } as any),
      params: {} as any, model: {} as any,
    } as any);
    // Bypass returns the original stream object unchanged (no piping).
    expect((result as any).stream).toBe(source);
  });
});