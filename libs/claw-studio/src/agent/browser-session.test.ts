import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPage = {
  goto: vi.fn(),
  title: vi.fn(() => Promise.resolve('T')),
  url: vi.fn(() => 'https://example.com'),
  close: vi.fn(),
};
const mockContext = { newPage: vi.fn(async () => mockPage), close: vi.fn(), route: vi.fn() };
const mockBrowser = { newContext: vi.fn(async () => mockContext), close: vi.fn() };
const mockLaunch = vi.fn(async () => mockBrowser);

vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => mockLaunch(...args) },
}));

const checkUrl = vi.fn(async () => ({ allowed: true }));
vi.mock('@chatbot/ai/tools/url-guard', () => ({ checkUrl: (...args: unknown[]) => checkUrl(...args) }));

import { BrowserSession, BrowserUnavailableError } from './browser-session';

describe('BrowserSession', () => {
  let session: BrowserSession;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(mockBrowser);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockContext.newPage.mockResolvedValue(mockPage);
    checkUrl.mockResolvedValue({ allowed: true });
    session = new BrowserSession({ tenantId: 't1', clawId: 'c1' });
  });

  afterEach(async () => {
    await session.close();
  });

  it('launches nothing until the first call', () => {
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(session.isOpen).toBe(false);
  });

  it('launches once and reuses the same page across calls', async () => {
    await session.run('first', async (page) => page.url());
    await session.run('second', async (page) => page.url());

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockContext.newPage).toHaveBeenCalledTimes(1);
    expect(session.isOpen).toBe(true);
  });

  it('launches headless with the hardening args', async () => {
    await session.run('go', async () => 'ok');

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
      }),
    );
  });

  it('installs the SSRF interceptor on the context', async () => {
    await session.run('go', async () => 'ok');

    expect(mockContext.route).toHaveBeenCalledWith('**/*', expect.any(Function));
  });

  it('aborts an intercepted request to a blocked destination', async () => {
    await session.run('go', async () => 'ok');
    const handler = mockContext.route.mock.calls[0][1] as (route: unknown) => Promise<void>;
    checkUrl.mockResolvedValue({ allowed: false, reason: 'link-local address' });

    const route = {
      abort: vi.fn(),
      continue: vi.fn(),
      request: () => ({ url: () => 'http://169.254.169.254/' }),
    };
    await handler(route);

    expect(route.abort).toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('serialises concurrent calls instead of interleaving them', async () => {
    const order: string[] = [];
    const slow = session.run('slow', async () => {
      order.push('slow:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('slow:end');
      return 'a';
    });
    const fast = session.run('fast', async () => {
      order.push('fast:start');
      order.push('fast:end');
      return 'b';
    });

    await Promise.all([slow, fast]);

    expect(order).toEqual(['slow:start', 'slow:end', 'fast:start', 'fast:end']);
  });

  it('keeps the queue moving when one call throws', async () => {
    const failed = session.run('boom', async () => {
      throw new Error('selector not found');
    });
    const after = session.run('after', async () => 'still works');

    await expect(failed).rejects.toThrow('selector not found');
    await expect(after).resolves.toBe('still works');
  });

  it('closes idempotently', async () => {
    await session.run('go', async () => 'ok');

    await session.close();
    await session.close();

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(session.isOpen).toBe(false);
  });

  it('closes safely when nothing was ever launched', async () => {
    await expect(session.close()).resolves.toBeUndefined();
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });

  it('reports an actionable error when chromium is unavailable', async () => {
    mockLaunch.mockRejectedValue(new Error("Executable doesn't exist at /ms-playwright/chromium"));

    await expect(session.run('go', async () => 'ok')).rejects.toBeInstanceOf(BrowserUnavailableError);
  });

  it('closes safely after a failed launch', async () => {
    mockLaunch.mockRejectedValue(new Error('no chromium'));
    await expect(session.run('go', async () => 'ok')).rejects.toThrow();

    await expect(session.close()).resolves.toBeUndefined();
    expect(session.isOpen).toBe(false);
  });

  it('retries the launch on a later call rather than latching the failure', async () => {
    mockLaunch.mockRejectedValueOnce(new Error('transient'));
    await expect(session.run('go', async () => 'ok')).rejects.toThrow();

    mockLaunch.mockResolvedValue(mockBrowser);
    await expect(session.run('go', async () => 'ok')).resolves.toBe('ok');
  });

  it('measures the wall-clock budget from the first open, not from a reopen', async () => {
    // Otherwise `browser_close` then `browser_open_url` resets the clock and the
    // budget never binds.
    const shortLived = new BrowserSession({ tenantId: 't1', clawId: 'c1', sessionMaxMs: 20 });
    await shortLived.run('go', async () => 'ok');
    await shortLived.close();
    await new Promise((resolve) => setTimeout(resolve, 35));

    await expect(shortLived.run('go', async () => 'ok')).rejects.toThrow(/budget/i);
    await shortLived.close();
  });

  it('refuses to open more concurrent sessions than the process cap', async () => {
    const first = new BrowserSession({ tenantId: 't1', clawId: 'c1', maxSessions: 1 });
    const second = new BrowserSession({ tenantId: 't2', clawId: 'c2', maxSessions: 1 });
    await first.run('go', async () => 'ok');

    await expect(second.run('go', async () => 'ok')).rejects.toThrow(/capacity|concurrent/i);

    await first.close();
    await second.close();
  });

  it('releases its slot on close so a later session can open', async () => {
    const first = new BrowserSession({ tenantId: 't1', clawId: 'c1', maxSessions: 1 });
    await first.run('go', async () => 'ok');
    await first.close();

    const second = new BrowserSession({ tenantId: 't2', clawId: 'c2', maxSessions: 1 });
    await expect(second.run('go', async () => 'ok')).resolves.toBe('ok');
    await second.close();
  });

  it('does not consume a slot when the launch fails', async () => {
    mockLaunch.mockRejectedValueOnce(new Error('transient'));
    const failed = new BrowserSession({ tenantId: 't1', clawId: 'c1', maxSessions: 1 });
    await expect(failed.run('go', async () => 'ok')).rejects.toThrow();

    const next = new BrowserSession({ tenantId: 't2', clawId: 'c2', maxSessions: 1 });
    await expect(next.run('go', async () => 'ok')).resolves.toBe('ok');
    await next.close();
  });

  it('closes itself after the idle timeout', async () => {
    const idle = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 20 });
    await idle.run('go', async () => 'ok');
    expect(idle.isOpen).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 45));

    expect(idle.isOpen).toBe(false);
  });

  it('keeps the session alive while calls keep arriving', async () => {
    const idle = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 40 });
    await idle.run('go', async () => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await idle.run('go', async () => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(idle.isOpen).toBe(true);
    await idle.close();
  });

  it('refuses further calls once the session wall-clock cap is exceeded', async () => {
    const shortLived = new BrowserSession({ tenantId: 't1', clawId: 'c1', sessionMaxMs: 10 });
    await shortLived.run('go', async () => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 25));

    await expect(shortLived.run('go', async () => 'ok')).rejects.toThrow(/session (budget|limit|expired)/i);
    await shortLived.close();
  });

  // A turn that pauses at an approval gate hands control to a human, who takes
  // seconds-to-minutes to answer. Every timer and budget below has to treat that
  // pause as "not the model's doing", or the page the human is approving an
  // action against is gone by the time they approve it.
  describe('hold (paused for a human approval)', () => {
    it('suspends the idle timer so a human pause does not close the page', async () => {
      const held = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 20, holdMs: 500 });
      await held.run('open_url', async () => 'ok');

      held.hold();
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(held.isOpen).toBe(true);
      await held.close();
    });

    it('still closes after the hold cap, so an unanswered approval cannot leak chromium', async () => {
      const held = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 500, holdMs: 20 });
      await held.run('open_url', async () => 'ok');

      held.hold();
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(held.isOpen).toBe(false);
    });

    it('does not count held time against the session budget', async () => {
      // Otherwise a three-approval form fill exhausts a 5-minute budget on human
      // deliberation alone, and the model is told it may not browse further.
      const held = new BrowserSession({ tenantId: 't1', clawId: 'c1', sessionMaxMs: 40, holdMs: 500 });
      await held.run('open_url', async () => 'ok');

      held.hold();
      await new Promise((resolve) => setTimeout(resolve, 60));

      await expect(held.run('click', async () => 'ok')).resolves.toBe('ok');
      await held.close();
    });

    it('resumes the idle timer once a call arrives after the hold', async () => {
      const held = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 20, holdMs: 500 });
      await held.run('open_url', async () => 'ok');
      held.hold();
      await held.run('click', async () => 'ok');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(held.isOpen).toBe(false);
    });
  });

  // The bug that made Claw diagnose "browser session instability": the page was
  // silently replaced by a fresh about:blank and the tool result read as success.
  describe('losing the page involuntarily', () => {
    it('refuses to interact on a page it silently lost, naming the reason', async () => {
      const idle = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 20 });
      await idle.run('open_url', async () => 'ok');
      await new Promise((resolve) => setTimeout(resolve, 45));

      await expect(idle.run('click', async () => 'clicked')).rejects.toThrow(/closed|reopen|browser_open_url/i);
      await idle.close();
    });

    it('lets browser_open_url recover the session instead of dead-ending it', async () => {
      const idle = new BrowserSession({ tenantId: 't1', clawId: 'c1', idleMs: 20 });
      await idle.run('open_url', async () => 'ok');
      await new Promise((resolve) => setTimeout(resolve, 45));

      await expect(idle.run('open_url', async () => 'reopened')).resolves.toBe('reopened');
      await expect(idle.run('click', async () => 'clicked')).resolves.toBe('clicked');
      await idle.close();
    });

    it('says nothing when the model closed the page itself', async () => {
      // browser_close is the model's own doing — it does not need to be told.
      await session.run('open_url', async () => 'ok');
      await session.close();

      await expect(session.run('click', async () => 'clicked')).resolves.toBe('clicked');
    });
  });
});
