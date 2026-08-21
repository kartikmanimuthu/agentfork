import { describe, it, expect } from 'vitest';
import { registerRun, cancelRun, isAborted, cleanupRun, getActiveRunIds } from './run-manager';

describe('run-manager', () => {
  it('registers a run and reports it as not aborted', () => {
    const controller = registerRun('thread-1');
    expect(controller).toBeInstanceOf(AbortController);
    expect(isAborted('thread-1')).toBe(false);
    cleanupRun('thread-1', controller);
  });

  it('cancels a registered run and reports it as aborted', () => {
    const controller = registerRun('thread-2');
    expect(cancelRun('thread-2')).toBe(true);
    expect(isAborted('thread-2')).toBe(true);
    cleanupRun('thread-2', controller);
  });

  it('returns false cancelling an unregistered run', () => {
    expect(cancelRun('nonexistent')).toBe(false);
  });

  it('cleanup removes the registration so a stale check no longer reports aborted', () => {
    const controller = registerRun('thread-3');
    cancelRun('thread-3');
    cleanupRun('thread-3', controller);
    expect(isAborted('thread-3')).toBe(false);
  });

  it('lists active run ids', () => {
    const controller = registerRun('thread-4');
    expect(getActiveRunIds()).toContain('thread-4');
    cleanupRun('thread-4', controller);
  });

  it('REGRESSION: a stale cleanup from an OLD controller does not delete a NEWER registration on the same threadId', () => {
    // Exactly the race a detached background task (chat route's memory_save
    // deferral) can hit: turn 1 hands its tail off and cleans up late, but by
    // then turn 2 has already registered on the same thread. The old
    // controller must not be able to evict the new one.
    const oldController = registerRun('thread-5');
    const newController = registerRun('thread-5'); // turn 2 starts before turn 1's cleanup runs

    cleanupRun('thread-5', oldController); // turn 1's late cleanup

    expect(getActiveRunIds()).toContain('thread-5');
    expect(cancelRun('thread-5')).toBe(true); // still cancellable — turn 2's entry survived
    expect(newController.signal.aborted).toBe(true);
    expect(oldController.signal.aborted).toBe(false); // turn 1 was never touched

    cleanupRun('thread-5', newController);
  });
});
