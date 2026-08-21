/**
 * event-bus.ts — in-process pub/sub keyed by run id.
 *
 * Scope note (design reference §3/§9): this is deliberately in-memory and
 * single-process. That is safe here ONLY because the whole emit→notify
 * lifecycle lives inside one worker job: the gateway route in Next never
 * subscribes, it just enqueues. Nothing crosses a process boundary, so there is
 * no need for Redis/SQS yet. Swapping in a broker later means reimplementing
 * `emit`/`subscribe`/`cleanup` and nothing above them changes.
 *
 * Addition over the reference: `drain(runId)` awaits the promises returned by
 * async subscribers. EventEmitter's `emit` returns as soon as each handler has
 * been *called*, so a caller that emits `run:completed` and immediately calls
 * `cleanup()` can tear the bus down while the notification router is still
 * mid-fetch. drain() closes that race.
 */

import { EventEmitter } from 'events';
import { createLogger } from '@chatbot/shared';
import type { BusEvent } from './types';

const logger = createLogger('claw-studio:gateway:bus');

export type BusHandler = (event: BusEvent) => void | Promise<void>;

function channelFor(runId: string): string {
  return `run:${runId}`;
}

export class RunEventBus {
  private readonly emitter = new EventEmitter();
  /** In-flight async handler promises, per run, awaited by drain(). */
  private readonly inFlight = new Map<string, Set<Promise<void>>>();

  constructor() {
    // Subscriber counts are small (one router per run) but a leaked
    // unsubscribe would otherwise trip Node's default 10-listener warning.
    this.emitter.setMaxListeners(100);
  }

  emit(event: BusEvent): void {
    this.emitter.emit(channelFor(event.runId), event);
  }

  /** Subscribe to every event for one run. Returns an unsubscribe closure. */
  subscribe(runId: string, handler: BusHandler): () => void {
    const wrapped = (event: BusEvent) => {
      let result: void | Promise<void>;
      try {
        result = handler(event);
      } catch (error) {
        // A throwing subscriber must never break the run that emitted.
        logger.error({ error, runId, event: event.name }, 'Bus subscriber threw');
        return;
      }
      if (!result || typeof (result as Promise<void>).then !== 'function') return;

      const promise = (result as Promise<void>).catch((error: unknown) => {
        logger.error({ error, runId, event: event.name }, 'Bus subscriber rejected');
      });
      const set = this.inFlight.get(runId) ?? new Set<Promise<void>>();
      set.add(promise);
      this.inFlight.set(runId, set);
      void promise.finally(() => set.delete(promise));
    };

    const channel = channelFor(runId);
    this.emitter.on(channel, wrapped);
    return () => this.emitter.off(channel, wrapped);
  }

  /** Resolves once the next matching event fires. */
  subscribeOnce(runId: string, name: BusEvent['name']): Promise<BusEvent> {
    return new Promise((resolve) => {
      const off = this.subscribe(runId, (event) => {
        if (event.name === name) {
          off();
          resolve(event);
        }
      });
    });
  }

  /**
   * Awaits every async handler triggered so far for this run. Handlers spawned
   * by those handlers are picked up too, since the set is re-read each pass.
   */
  async drain(runId: string): Promise<void> {
    for (let pass = 0; pass < 10; pass++) {
      const set = this.inFlight.get(runId);
      if (!set || set.size === 0) return;
      await Promise.all([...set]);
    }
    logger.warn({ runId }, 'Bus drain hit its pass limit — subscribers may be emitting in a loop');
  }

  cleanup(runId: string): void {
    this.emitter.removeAllListeners(channelFor(runId));
    this.inFlight.delete(runId);
  }

  listenerCount(runId: string): number {
    return this.emitter.listenerCount(channelFor(runId));
  }
}

const g = globalThis as typeof globalThis & { _clawRunEventBus?: RunEventBus };

/** Process-wide singleton — dev hot reload must not create a second bus. */
export function getRunEventBus(): RunEventBus {
  if (!g._clawRunEventBus) {
    g._clawRunEventBus = new RunEventBus();
  }
  return g._clawRunEventBus;
}
