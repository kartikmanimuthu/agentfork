/**
 * browser-session-registry.ts — keeps one BrowserSession alive per thread,
 * across HTTP requests.
 *
 * `resolveClawRuntime()` runs once per incoming request, and it used to
 * construct a fresh `BrowserSession` each time while `runtime.cleanup()` closed
 * it on the way out — including on the request that ends parked at an approval
 * gate (`chat/route.ts`'s `!handedOff` branch, `execute-run.ts`'s `finally`).
 * Since `browser_click`/`browser_type`/`browser_select`/`browser_open_url` all
 * classify as mutative (`tool-classifier.ts`), *every* interaction with a page
 * pauses the turn — so the page was torn down between "here is the form" and
 * the approved click, which then landed on a fresh `about:blank`. The model saw
 * a page that kept resetting itself and reasonably concluded the browser
 * infrastructure was unstable.
 *
 * Browsing continuity therefore has to outlive the request, and the natural
 * owner is the thread: one conversation, one browser, one page.
 *
 * **Process-local by design, and that is a real constraint.** The Chromium lives
 * in whichever container resolved the run, so a browsing turn's approval must
 * come back to that same process. Single-container deployments (today's) are
 * fine; behind more than one mission-control replica this needs sticky routing
 * on the chat session, or the resumed turn finds no live page — which now
 * surfaces as an explicit "call browser_open_url again" tool error rather than a
 * silent blank page (`BrowserSession.close({ pageLost: true })`).
 */

import { BrowserSession, type BrowserSessionOptions } from './browser-session';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:browser-session-registry');

/**
 * Bound on tracked entries, not on live browsers — `CLAW_BROWSER_MAX_SESSIONS`
 * still caps concurrent Chromiums. Entries outlive their browser on purpose (a
 * self-closed session is kept so the next turn can be told its page is gone),
 * and without a cap that bookkeeping would grow with every thread the process
 * ever served.
 */
export const MAX_TRACKED_SESSIONS = 64;

/** Insertion-ordered, so the first key is the least recently used. */
const sessions = new Map<string, BrowserSession>();

function touch(key: string, session: BrowserSession): void {
  sessions.delete(key);
  sessions.set(key, session);
}

function evictIfNeeded(): void {
  while (sessions.size > MAX_TRACKED_SESSIONS) {
    const [oldestKey, oldest] = sessions.entries().next().value as [string, BrowserSession];
    sessions.delete(oldestKey);
    logger.info({ key: oldestKey, tracked: sessions.size }, 'Evicting least recently used browser session');
    // Fire and forget: eviction happens on the acquire path, which must not wait
    // on a Chromium teardown. Never throws — `close` swallows its own failures.
    void oldest.close({ pageLost: true }).catch((error: unknown) => {
      logger.warn({ key: oldestKey, error }, 'Failed to close evicted browser session');
    });
  }
}

/**
 * The live session for `key`, creating one if there is none. Nothing is launched
 * here — `BrowserSession` opens Chromium lazily on its first tool call, so a run
 * that never browses still pays nothing.
 *
 * `options` apply only when a session is created; an existing session keeps the
 * budgets it was built with, so a mid-thread config change cannot silently
 * extend a session already in flight.
 */
export function acquireBrowserSession(key: string, options: BrowserSessionOptions): BrowserSession {
  const existing = sessions.get(key);
  if (existing) {
    touch(key, existing);
    return existing;
  }
  const session = new BrowserSession(options);
  sessions.set(key, session);
  evictIfNeeded();
  return session;
}

/**
 * Parks `key`'s browser while its turn waits on an approval decision: the page
 * stays open (bounded by the session's `holdMs`) instead of being torn down
 * between the prompt and the answer. No-op when nothing is tracked, so callers
 * can hold unconditionally on the interrupt path.
 */
export function holdBrowserSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  session.hold();
}

/** Closes `key`'s browser and stops tracking it. Safe for an unknown key. */
export async function releaseBrowserSession(key: string): Promise<void> {
  const session = sessions.get(key);
  sessions.delete(key);
  if (!session) return;
  try {
    // Deliberately a plain close: the run ending is the caller's own doing, so
    // there is no lost page to warn a future turn about.
    await session.close();
  } catch (error) {
    logger.warn({ key, error }, 'Failed to close browser session');
  }
}

/** Test/observability helper — tracked entries, live or self-closed. */
export function trackedBrowserSessionCount(): number {
  return sessions.size;
}

/** Test-only: closes and forgets everything. */
export async function resetBrowserSessionRegistry(): Promise<void> {
  const all = [...sessions.keys()];
  await Promise.allSettled(all.map((key) => releaseBrowserSession(key)));
  sessions.clear();
}
