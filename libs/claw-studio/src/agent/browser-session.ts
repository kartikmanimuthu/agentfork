/**
 * browser-session.ts — one Playwright browser per Claw run.
 *
 * Ported from OpenWorker's `_BrowserController`
 * (`coworker/connectors/browser_automation.py`) with two deliberate changes,
 * both forced by the fact that we are a shared multi-tenant server and they are
 * one process on one person's desktop:
 *
 *  1. **Per run, not a module singleton.** Their controller is a module-level
 *     global, which is safe when one human owns the machine. Here a global would
 *     hand one tenant's live page to another tenant's run.
 *  2. **Headless.** Theirs is `headless=False` so the owner can watch, and that
 *     visible window doubles as their answer to login walls — the human types
 *     the password in themselves. We have no screen and no human at this
 *     machine, which is precisely why authenticated browsing is out of scope.
 *
 * The mutex is theirs, though: `threading.RLock` plus a single-worker executor
 * becomes a promise chain here. Without it two concurrent tool calls can
 * interleave a click and a navigation on the same page.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { checkUrl } from '@chatbot/ai/tools/url-guard';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:browser-session');

const VIEWPORT = { width: 1280, height: 900 };

/** Matches `web-fetch.ts` — a default UA gets 404s from news sites and CDNs. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Raised when Chromium cannot be launched at all — a deployment problem, not a
 * page problem. Distinct from a navigation failure so the tool layer can return
 * "browsing is unavailable in this deployment" instead of a Playwright stack
 * trace, the way OpenWorker's `_setup_error` does.
 */
export class BrowserUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'Browser automation is unavailable in this deployment. Chromium could not be launched — ' +
        'the runtime image may be missing `playwright install chromium`.',
    );
    this.name = 'BrowserUnavailableError';
    this.cause = cause;
  }
}

export interface BrowserSessionOptions {
  tenantId: string;
  clawId: string;
  runId?: string;
  /** Per-navigation timeout. Matches web-fetch.ts's NAVIGATION_TIMEOUT_MS. */
  navTimeoutMs?: number;
  /** Hard cap on how long one run may keep a browser open. Held time is excluded. */
  sessionMaxMs?: number;
  /** Close the browser after this long with no tool call. */
  idleMs?: number;
  /**
   * Cap on one `hold()` — how long the browser may stay open while a turn is
   * parked at an approval gate waiting on a human. Longer than `idleMs` because
   * a person reading an approval prompt is slower than a model, but still
   * bounded: an approval nobody ever answers must not pin a Chromium forever.
   */
  holdMs?: number;
  /** How many browsers may be open at once in THIS process, across all runs. */
  maxSessions?: number;
  /** Test-only escape hatch so a fixture server on 127.0.0.1 is reachable. */
  allowPrivateHosts?: boolean;
}

/**
 * Process-wide count of live browsers. Chromium is heavy and this process also
 * serves HTTP (mission-control) — without a ceiling, a burst of concurrent
 * browsing runs is an OOM rather than a queue. Deliberately module-level: the
 * resource being protected is the container, not any one run.
 *
 * `web_fetch` launches its own short-lived browser outside this count, so the
 * real ceiling is this plus the in-flight web_fetch calls.
 */
let openSessions = 0;

export class BrowserSession {
  private readonly opts: Required<
    Pick<
      BrowserSessionOptions,
      'navTimeoutMs' | 'sessionMaxMs' | 'idleMs' | 'holdMs' | 'maxSessions' | 'allowPrivateHosts'
    >
  > &
    BrowserSessionOptions;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /** Serialises every operation. Never rejects — see `run`. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * When this session FIRST opened a browser. Deliberately not cleared by
   * `discard()`: clearing it let `browser_close` followed by `browser_open_url`
   * reset the wall-clock budget, so a model could browse indefinitely by
   * closing and reopening.
   */
  private firstOpenedAt: number | null = null;
  private expired = false;
  private closing: Promise<void> | null = null;
  private holdsSlot = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set while a turn is parked at an approval gate. See `hold`. */
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private heldAt: number | null = null;
  /**
   * Total time spent held across this session's life, subtracted from the
   * `sessionMaxMs` budget. Human deliberation is not the model browsing, and
   * charging it to the budget made a three-approval form fill exhaust a
   * five-minute allowance before the model had done anything.
   */
  private heldTotalMs = 0;
  /** `hold()` arriving mid-call, applied by that call's `finally`. See `hold`. */
  private holdRequested = false;
  private inFlight = 0;

  /**
   * Set when a page we had was torn down by something the model did not ask for
   * — idle timeout, hold expiry, budget. `ensurePage` would otherwise hand back
   * a brand-new `about:blank` and the next click would "succeed" against
   * nothing, which is exactly how this looked like flaky infrastructure rather
   * than a closed session.
   */
  private pageLost = false;

  constructor(options: BrowserSessionOptions) {
    this.opts = {
      navTimeoutMs: 15_000,
      sessionMaxMs: 300_000,
      idleMs: 60_000,
      holdMs: 300_000,
      maxSessions: 3,
      allowPrivateHosts: false,
      ...options,
    };
  }

  get isOpen(): boolean {
    return this.page !== null;
  }

  /** True while parked at an approval gate — used by the registry's logging. */
  get isHeld(): boolean {
    return this.heldAt !== null;
  }

  get navTimeoutMs(): number {
    return this.opts.navTimeoutMs;
  }

  /**
   * Runs `fn` against the session's single page, serialised behind every call
   * already queued. `action` is for logging only.
   */
  run<T>(action: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.execute(action, fn));
    // The queue must survive a rejected operation, otherwise one failed
    // selector poisons every later call in the run.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(action: string, fn: (page: Page) => Promise<T>): Promise<T> {
    // A call arriving means the human answered — stop charging held time.
    this.releaseHold();

    if (this.expired) {
      throw new Error(`Browser session budget exceeded (${this.opts.sessionMaxMs}ms) — this run may not browse further.`);
    }

    if (this.activeMs() > this.opts.sessionMaxMs) {
      this.expired = true;
      logger.warn(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId, action },
        'Browser session budget exceeded — closing',
      );
      await this.close({ pageLost: true });
      throw new Error(`Browser session budget exceeded (${this.opts.sessionMaxMs}ms) — this run may not browse further.`);
    }

    // Only a navigation can rebuild the lost context, so it is the one action
    // allowed through; everything else would act on a blank page and report
    // success. Cleared here rather than after `fn` so a failed navigation still
    // leaves the session recoverable by the next one.
    if (action === 'open_url') {
      this.pageLost = false;
    } else if (this.pageLost) {
      throw new Error(
        'The browser session was closed since the page was opened (idle timeout, an unanswered approval, or the session budget) — ' +
          'the page you saw is gone. Call browser_open_url again to reopen it before interacting.',
      );
    }

    const page = await this.ensurePage();
    this.inFlight += 1;
    try {
      return await fn(page);
    } finally {
      this.inFlight -= 1;
      // Restarted after the call, not before, so a long navigation doesn't
      // count against the idle window.
      if (this.inFlight === 0 && this.holdRequested) {
        this.holdRequested = false;
        this.applyHold();
      } else {
        this.armIdleTimer();
      }
    }
  }

  /** Wall-clock since the first open, minus time parked on a human. */
  private activeMs(): number {
    if (this.firstOpenedAt === null) return 0;
    return Date.now() - this.firstOpenedAt - this.heldTotalMs;
  }

  /**
   * Parks the session while its turn waits on an approval decision: the run has
   * no calls in flight but the page must survive, because the very action the
   * human is approving is going to be performed on it.
   *
   * Without this, the request that ends at the approval gate tore the browser
   * down, and the approved click then ran against a fresh `about:blank`.
   */
  hold(): void {
    if (!this.page || this.expired) return;
    // A tool call still running owns the timers; let its `finally` apply the
    // hold instead of racing it and leaving an idle timer armed underneath.
    if (this.inFlight > 0) {
      this.holdRequested = true;
      return;
    }
    this.applyHold();
  }

  private applyHold(): void {
    if (!this.page || this.heldAt !== null) return;
    this.clearIdleTimer();
    this.heldAt = Date.now();
    this.holdTimer = setTimeout(() => {
      logger.info(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId, holdMs: this.opts.holdMs },
        'Browser session held past its approval window — closing',
      );
      void this.close({ pageLost: true });
    }, this.opts.holdMs);
    this.holdTimer.unref?.();
    logger.debug(
      { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId },
      'Browser session held for approval',
    );
  }

  private releaseHold(): void {
    this.holdRequested = false;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.heldAt !== null) {
      this.heldTotalMs += Date.now() - this.heldAt;
      this.heldAt = null;
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      logger.info(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId },
        'Browser session idle — closing',
      );
      void this.close({ pageLost: true });
    }, this.opts.idleMs);
    // Never hold the process open just to wait out an idle browser.
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;

    // Recoverable on purpose: a plain Error becomes a tool result the model can
    // react to (wait, or finish without browsing), whereas
    // BrowserUnavailableError reads as "this deployment cannot browse at all".
    if (openSessions >= this.opts.maxSessions) {
      throw new Error(
        `Browser capacity reached (${this.opts.maxSessions} concurrent sessions on this host). Try again shortly, or continue without browsing.`,
      );
    }
    openSessions += 1;
    this.holdsSlot = true;

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });

      this.context = await this.browser.newContext({
        viewport: VIEWPORT,
        userAgent: USER_AGENT,
        locale: 'en-US',
      });

      await this.installGuard(this.context);

      this.page = await this.context.newPage();
      this.firstOpenedAt ??= Date.now();

      logger.info(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId },
        'Browser session opened',
      );
      return this.page;
    } catch (error) {
      // Leave nothing half-built behind — a later call retries from scratch.
      await this.discard();
      logger.error(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, error },
        'Failed to launch browser',
      );
      throw new BrowserUnavailableError(error);
    }
  }

  /**
   * Re-checks every request the page makes. Checking only the URL handed to
   * `goto` is not enough: Chromium resolves redirects internally, so a public
   * host that 302s to 169.254.169.254 is invisible to a one-shot check, as are
   * subresources and in-page `fetch()`.
   */
  private async installGuard(context: BrowserContext): Promise<void> {
    await context.route('**/*', async (route) => {
      const target = route.request().url();
      const verdict = await checkUrl(target, { allowPrivateHosts: this.opts.allowPrivateHosts });
      if (verdict.allowed) {
        await route.continue();
        return;
      }
      logger.warn(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, target, reason: verdict.reason },
        'Aborted browser request to blocked destination',
      );
      await route.abort('blockedbyclient');
    });
  }

  /** Tears down whatever exists without logging — used on a failed launch. */
  private async discard(): Promise<void> {
    this.clearIdleTimer();
    this.releaseHold();
    const targets = [this.page, this.context, this.browser];
    this.page = null;
    this.context = null;
    this.browser = null;
    // NOT firstOpenedAt — see its declaration.
    if (this.holdsSlot) {
      openSessions -= 1;
      this.holdsSlot = false;
    }
    for (const target of targets) {
      try {
        await target?.close();
      } catch {
        // Already gone, or never fully constructed.
      }
    }
  }

  /**
   * Idempotent, and safe to call when nothing was ever launched. Concurrent
   * callers share one teardown rather than racing.
   *
   * `pageLost` marks a teardown the model did not ask for (idle, hold expiry,
   * budget), so a later interaction is told the page is gone instead of being
   * silently handed a fresh `about:blank`. A plain `close()` — `browser_close`,
   * or the run's own cleanup — is the caller's own doing and needs no such flag.
   */
  async close(opts: { pageLost?: boolean } = {}): Promise<void> {
    if (opts.pageLost && this.page) this.pageLost = true;
    if (this.closing) return this.closing;
    if (!this.browser && !this.context && !this.page) {
      // Nothing launched, but a reserved-then-failed slot or a pending idle
      // timer may still be outstanding.
      this.clearIdleTimer();
      this.releaseHold();
      if (this.holdsSlot) {
        openSessions -= 1;
        this.holdsSlot = false;
      }
      return;
    }

    this.closing = (async () => {
      logger.info(
        { tenantId: this.opts.tenantId, clawId: this.opts.clawId, runId: this.opts.runId },
        'Browser session closing',
      );
      await this.discard();
    })();

    try {
      await this.closing;
    } finally {
      this.closing = null;
    }
  }
}
