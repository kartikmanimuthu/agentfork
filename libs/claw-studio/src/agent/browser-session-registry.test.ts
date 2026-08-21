import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPage = {
  goto: vi.fn(),
  title: vi.fn(() => Promise.resolve('T')),
  url: vi.fn(() => 'https://example.com/form'),
  close: vi.fn(),
};
const mockContext = { newPage: vi.fn(async () => mockPage), close: vi.fn(), route: vi.fn() };
const mockBrowser = { newContext: vi.fn(async () => mockContext), close: vi.fn() };
const mockLaunch = vi.fn(async () => mockBrowser);

vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => mockLaunch(...args) },
}));

vi.mock('@chatbot/ai/tools/url-guard', () => ({ checkUrl: async () => ({ allowed: true }) }));

import {
  acquireBrowserSession,
  holdBrowserSession,
  releaseBrowserSession,
  trackedBrowserSessionCount,
  resetBrowserSessionRegistry,
  MAX_TRACKED_SESSIONS,
} from './browser-session-registry';

const opts = { tenantId: 't1', clawId: 'c1' };

describe('browser session registry', () => {
  beforeEach(async () => {
    await resetBrowserSessionRegistry();
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(mockBrowser);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockContext.newPage.mockResolvedValue(mockPage);
  });

  afterEach(async () => {
    await resetBrowserSessionRegistry();
  });

  it('hands the same session back for the same key', () => {
    const first = acquireBrowserSession('thread-a', opts);
    const second = acquireBrowserSession('thread-a', opts);

    expect(second).toBe(first);
  });

  it('keeps separate sessions per key so two threads never share a page', () => {
    expect(acquireBrowserSession('thread-a', opts)).not.toBe(acquireBrowserSession('thread-b', opts));
  });

  // The regression this whole registry exists for: an approval interrupt used to
  // close the browser, so the approved click ran on a fresh about:blank.
  it('survives a hold and reopens on the same live page', async () => {
    const session = acquireBrowserSession('thread-a', { ...opts, holdMs: 5_000 });
    await session.run('open_url', async (page) => page.url());

    holdBrowserSession('thread-a');
    const resumed = acquireBrowserSession('thread-a', { ...opts, holdMs: 5_000 });

    expect(resumed).toBe(session);
    expect(resumed.isOpen).toBe(true);
    await expect(resumed.run('click', async (page) => page.url())).resolves.toBe('https://example.com/form');
    // One launch across the whole approval round trip.
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  it('closes and forgets a released session', async () => {
    const session = acquireBrowserSession('thread-a', opts);
    await session.run('open_url', async () => 'ok');

    await releaseBrowserSession('thread-a');

    expect(session.isOpen).toBe(false);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(trackedBrowserSessionCount()).toBe(0);
  });

  it('releases a key that was never acquired without throwing', async () => {
    await expect(releaseBrowserSession('never-seen')).resolves.toBeUndefined();
  });

  it('holds a key that was never acquired without throwing', () => {
    expect(() => holdBrowserSession('never-seen')).not.toThrow();
  });

  // A session that reaped itself stays tracked precisely so the next turn is
  // told the page is gone rather than silently acting on a blank one.
  it('keeps a self-closed session so the next turn learns the page was lost', async () => {
    const session = acquireBrowserSession('thread-a', { ...opts, idleMs: 20 });
    await session.run('open_url', async () => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 45));

    const next = acquireBrowserSession('thread-a', { ...opts, idleMs: 20 });
    expect(next).toBe(session);
    await expect(next.run('click', async () => 'clicked')).rejects.toThrow(/browser_open_url/i);
  });

  it('evicts the least recently used session past the tracking cap', async () => {
    for (let i = 0; i <= MAX_TRACKED_SESSIONS; i += 1) {
      acquireBrowserSession(`thread-${i}`, opts);
    }

    expect(trackedBrowserSessionCount()).toBe(MAX_TRACKED_SESSIONS);
  });

  it('closes an evicted session rather than leaking its chromium', async () => {
    const evicted = acquireBrowserSession('thread-0', opts);
    await evicted.run('open_url', async () => 'ok');
    for (let i = 1; i <= MAX_TRACKED_SESSIONS; i += 1) {
      acquireBrowserSession(`thread-${i}`, opts);
    }

    // Eviction closes asynchronously; let its promise settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(evicted.isOpen).toBe(false);
  });
});
