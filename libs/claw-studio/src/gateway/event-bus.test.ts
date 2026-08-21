import { describe, it, expect, vi } from 'vitest';
import { RunEventBus } from './event-bus';
import type { BusEvent } from './types';

const completed = (runId: string): BusEvent => ({ name: 'run:completed', runId });

describe('RunEventBus', () => {
  it('delivers events only to subscribers of the same run', () => {
    const bus = new RunEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('run_a', a);
    bus.subscribe('run_b', b);

    bus.emit(completed('run_a'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new RunEventBus();
    const handler = vi.fn();
    const off = bus.subscribe('run_a', handler);

    bus.emit(completed('run_a'));
    off();
    bus.emit(completed('run_a'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drain() waits for async subscribers — the race that would otherwise let cleanup() cut off a notification mid-send', async () => {
    const bus = new RunEventBus();
    let finished = false;
    bus.subscribe('run_a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });

    bus.emit(completed('run_a'));
    // emit() returns as soon as the handler was *called*, not when it resolved.
    expect(finished).toBe(false);

    await bus.drain('run_a');
    expect(finished).toBe(true);
  });

  it('drain() also waits for work a subscriber starts after its first await', async () => {
    const bus = new RunEventBus();
    const order: string[] = [];
    bus.subscribe('run_a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('second');
    });

    bus.emit(completed('run_a'));
    await bus.drain('run_a');

    expect(order).toEqual(['first', 'second']);
  });

  it('a throwing subscriber does not break emit for the run that emitted', () => {
    const bus = new RunEventBus();
    const good = vi.fn();
    bus.subscribe('run_a', () => {
      throw new Error('adapter exploded');
    });
    bus.subscribe('run_a', good);

    expect(() => bus.emit(completed('run_a'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('a rejecting async subscriber is swallowed rather than becoming an unhandled rejection', async () => {
    const bus = new RunEventBus();
    bus.subscribe('run_a', async () => {
      throw new Error('send failed');
    });

    bus.emit(completed('run_a'));
    await expect(bus.drain('run_a')).resolves.toBeUndefined();
  });

  it('cleanup removes every listener for the run', () => {
    const bus = new RunEventBus();
    bus.subscribe('run_a', vi.fn());
    bus.subscribe('run_a', vi.fn());
    expect(bus.listenerCount('run_a')).toBe(2);

    bus.cleanup('run_a');
    expect(bus.listenerCount('run_a')).toBe(0);
  });

  it('subscribeOnce resolves on the first matching event and ignores others', async () => {
    const bus = new RunEventBus();
    const pending = bus.subscribeOnce('run_a', 'run:completed');

    bus.emit({ name: 'run:failed', runId: 'run_a', error: 'nope' });
    bus.emit(completed('run_a'));

    await expect(pending).resolves.toMatchObject({ name: 'run:completed' });
  });
});
