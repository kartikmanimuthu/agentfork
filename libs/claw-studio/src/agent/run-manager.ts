/**
 * Run Manager — AbortController registry for in-flight Claw runs.
 *
 * Ported from nucleus lib/agent-ops/run-manager.ts, keyed by threadId instead
 * of runId (Mission Control's chat is a single request/response per turn, not
 * a long-lived async run polled across replicas like nucleus' Agent Ops, so
 * the cross-replica DB-polling compensation nucleus needs does not apply
 * here — this registry alone is sufficient to let a user abort an in-flight
 * streaming reply).
 *
 * Singleton scoped to the Node.js process (survives across requests) via
 * globalThis, matching the source.
 */

const g = globalThis as typeof globalThis & {
  _clawRunRegistry?: Map<string, AbortController>;
};

function getRegistry(): Map<string, AbortController> {
  if (!g._clawRunRegistry) {
    g._clawRunRegistry = new Map();
  }
  return g._clawRunRegistry;
}

/** Register a new run and return its AbortController. */
export function registerRun(threadId: string): AbortController {
  const controller = new AbortController();
  getRegistry().set(threadId, controller);
  return controller;
}

/** Cancel a run by threadId. Returns true if the run was found and cancelled. */
export function cancelRun(threadId: string): boolean {
  const controller = getRegistry().get(threadId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Check if a run has been aborted. */
export function isAborted(threadId: string): boolean {
  return getRegistry().get(threadId)?.signal.aborted ?? false;
}

/**
 * Remove a run from the registry (call in a finally block).
 *
 * Requires the SAME controller `registerRun` returned, checked by identity
 * before deleting. Without this, a slow run whose cleanup fires late (e.g.
 * one that hands its tail off to a detached background task, per the chat
 * route's memory_save deferral) could delete a DIFFERENT, newer run's entry
 * that has since registered under the same threadId — silently breaking that
 * newer run's "Stop generating" button.
 */
export function cleanupRun(threadId: string, controller: AbortController): void {
  if (getRegistry().get(threadId) === controller) {
    getRegistry().delete(threadId);
  }
}

/** List all currently registered (active) thread ids. */
export function getActiveRunIds(): string[] {
  return Array.from(getRegistry().keys());
}
