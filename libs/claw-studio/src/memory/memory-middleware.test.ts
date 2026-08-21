import { describe, it, expect, vi } from 'vitest';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { createClawMemoryMiddleware } from './memory-middleware';

describe('createClawMemoryMiddleware', () => {
  // Fix round 2, Important 3 — recall moved from `beforeModel` (fires before
  // EVERY model call in a multi-iteration turn) to `beforeAgent` (fires once
  // per invocation), matching the old graph's single memory_recall node.
  it('recalls once per invocation and injects context', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: 'REMEMBERED', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    expect(mw.beforeModel).toBeUndefined();
    expect(typeof mw.beforeAgent).toBe('function');

    const state = { messages: [{ _getType: () => 'human', content: 'hi' }] };
    const patch = await mw.beforeAgent!(state as never, {} as never);

    expect(recall).toHaveBeenCalledOnce();
    expect(JSON.stringify(patch)).toContain('REMEMBERED');
  });

  it('saves after the turn completes', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await mw.afterAgent!({ messages: [] } as never, { configurable: { thread_id: 't1' } } as never);
    expect(save).toHaveBeenCalledOnce();
  });

  it('passes the runtime through to saveNode with thread_id intact', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await mw.afterAgent!({ messages: [] } as never, { configurable: { thread_id: 't1' } } as never);

    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ configurable: expect.objectContaining({ thread_id: 't1' }) }),
    );
  });

  it('does not inject context when memoryContext is empty (degraded recall)', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    const patch = await mw.beforeAgent!({ messages: [] } as never, {} as never);

    expect(recall).toHaveBeenCalledOnce();
    expect(patch).toBeUndefined();
  });

  // Both hooks used to drop the stats `memory-nodes.ts` had already computed —
  // `beforeAgent` destructured only `memoryContext`, and `afterAgent` discarded
  // saveNode's return entirely. Nothing downstream could then tell that memory
  // had run at all, which is why recall and save never appeared on the chat
  // timeline. `gateway/execute-run.ts`'s deriveNodeEvents reads this channel.
  it('returns recall stats so the timeline can show what was recalled', async () => {
    const stats = { phase: 'recall', facts: [{ key: 'a' }], rules: [], episodes: [], injected: true };
    const recall = vi.fn().mockResolvedValue({ memoryContext: 'REMEMBERED', memoryStats: stats });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    const patch = await mw.beforeAgent!({ messages: [] } as never, {} as never);

    expect(patch).toMatchObject({ memoryContext: 'REMEMBERED', memoryStats: stats });
  });

  it('returns recall stats even when the recall found nothing', async () => {
    // An empty recall is still activity worth showing — "searched, found
    // nothing" is information. Returning undefined here is what made memory
    // look switched off on turns where it simply had no match.
    const stats = { phase: 'recall', facts: [], rules: [], episodes: [], injected: false };
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: stats });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    const patch = await mw.beforeAgent!({ messages: [] } as never, {} as never);

    expect(patch).toMatchObject({ memoryStats: stats });
    // Still must not inject an empty context section.
    expect((patch as { memoryContext?: string })?.memoryContext).toBeUndefined();
  });

  it('returns save stats so the timeline can show what was written', async () => {
    const stats = { phase: 'save', savedFacts: 2, savedRules: 0, episodeCaptured: true };
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: stats });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    const patch = await mw.afterAgent!({ messages: [] } as never, {} as never);

    expect(patch).toMatchObject({ memoryStats: stats });
  });

  it('declares memoryStats on its own stateSchema, or the hooks cannot write it', async () => {
    // derivePrivateState scopes each hook's channels to THIS middleware's
    // schema (see the module doc) — a field missing here is silently dropped
    // rather than erroring, which is the failure mode this whole fix is about.
    const mw = createClawMemoryMiddleware({
      recallNode: vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null }),
      saveNode: vi.fn().mockResolvedValue({ memoryStats: null }),
    });
    expect(Object.keys(mw.stateSchema!.shape)).toContain('memoryStats');
  });

  it('never throws when recall fails — memory is non-fatal', async () => {
    const recall = vi.fn().mockRejectedValue(new Error('pgvector down'));
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await expect(mw.beforeAgent!({ messages: [] } as never, {} as never)).resolves.not.toThrow();
  });

  it('never throws when save fails', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockRejectedValue(new Error('boom'));
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await expect(mw.afterAgent!({ messages: [] } as never, {} as never)).resolves.not.toThrow();
  });

  // Fix round 2, Critical 1 — recall previously only wrote `state.memoryContext`;
  // nothing read it back into the outgoing prompt, so the model never saw what
  // was recalled. `wrapModelCall` is the fix: it must append the SAME wrapper
  // text `getDynamicContext()` uses at claw-graph.ts:213, verbatim.
  describe('wrapModelCall', () => {
    it('appends the recalled memoryContext to the outgoing system message, verbatim wrapper text', async () => {
      const mw = createClawMemoryMiddleware({ recallNode: vi.fn(), saveNode: vi.fn() });
      expect(typeof mw.wrapModelCall).toBe('function');

      const request = {
        systemMessage: new SystemMessage('BASE PROMPT'),
        state: { memoryContext: 'REMEMBERED FACT' },
      };
      const handler = vi.fn(async () => new AIMessage('ok'));

      await mw.wrapModelCall!(request as never, handler as never);

      expect(handler).toHaveBeenCalledOnce();
      const passed = handler.mock.calls[0][0] as { systemMessage: SystemMessage };
      const text = String(passed.systemMessage.content);
      expect(text).toContain('BASE PROMPT');
      expect(text).toContain('REMEMBERED FACT');
      // The exact caveat from claw-graph.ts:213 — reused verbatim, not
      // reworded, so recalled memory reads identically across execution paths.
      expect(text).toContain(
        "trust only the tools actually available to you in this message, never a memory note about it",
      );
    });

    it('passes the request through unchanged when memoryContext is empty', async () => {
      const mw = createClawMemoryMiddleware({ recallNode: vi.fn(), saveNode: vi.fn() });
      const request = { systemMessage: new SystemMessage('BASE'), state: { memoryContext: '' } };
      const handler = vi.fn(async () => new AIMessage('ok'));

      await mw.wrapModelCall!(request as never, handler as never);

      expect(handler).toHaveBeenCalledWith(request);
    });

    it('never throws and falls through to handler(request) if appending fails', async () => {
      const mw = createClawMemoryMiddleware({ recallNode: vi.fn(), saveNode: vi.fn() });
      // No `systemMessage.concat` on this malformed stand-in — forces the
      // catch branch, proving a broken append still lets the turn proceed.
      const request = { systemMessage: { content: 'BASE' }, state: { memoryContext: 'X' } };
      const handler = vi.fn(async () => new AIMessage('ok'));

      await expect(mw.wrapModelCall!(request as never, handler as never)).resolves.not.toThrow();
      expect(handler).toHaveBeenCalledWith(request);
    });
  });
});
