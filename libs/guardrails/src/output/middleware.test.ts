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
});