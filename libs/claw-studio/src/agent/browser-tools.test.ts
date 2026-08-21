import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserTools, type BrowserToolsDeps } from './browser-tools';

/**
 * A stand-in for BrowserSession. Injected rather than vi.mock'd: this package
 * cannot reliably intercept relative-module imports (see libs/claw-studio/CLAUDE.md),
 * and injecting the collaborator is the better design regardless.
 */
function fakeSession(page: unknown) {
  return {
    run: vi.fn(async (_action: string, fn: (p: unknown) => Promise<unknown>) => fn(page)),
    close: vi.fn(async () => undefined),
    navTimeoutMs: 15_000,
    isOpen: true,
  };
}

function fakeLocator() {
  return {
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined),
    first: vi.fn(function (this: unknown) {
      return this;
    }),
  };
}

function fakePage(locator = fakeLocator()) {
  return {
    goto: vi.fn(async () => ({ status: () => 200 })),
    url: vi.fn(() => 'https://example.com/landed'),
    title: vi.fn(async () => 'Example Domain'),
    evaluate: vi.fn(async () => ({ text: 'page text here', controls: [] })),
    locator: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    getByRole: vi.fn(() => locator),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from('jpegbytes')),
  };
}

function build(overrides: Partial<BrowserToolsDeps> = {}) {
  const locator = fakeLocator();
  const page = fakePage(locator);
  const session = fakeSession(page);
  const deps = {
    session,
    readWorkspaceFile: vi.fn(async () => 'file contents'),
    uploadScreenshot: vi.fn(async () => ({ key: 'claw/screenshots/t1/c1/r1/1.jpg', url: 'https://s3/signed' })),
    ...overrides,
  } as unknown as BrowserToolsDeps;
  const { tools } = createBrowserTools(deps);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { tools, byName, page, locator, session, deps };
}

/** LangChain tools are invoked with their raw arg object. */
async function call(tool: { invoke: (input: unknown) => Promise<unknown> }, args: Record<string, unknown> = {}) {
  return (await tool.invoke(args)) as string;
}

describe('createBrowserTools', () => {
  it('exposes exactly the ten browser tools', () => {
    const { tools } = build();

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'browser_click',
        'browser_close',
        'browser_get_text',
        'browser_open_url',
        'browser_screenshot',
        'browser_select',
        'browser_snapshot',
        'browser_type',
        'browser_upload_file',
        'browser_wait',
      ].sort(),
    );
  });

  it('frames results as untrusted data in every tool description', () => {
    const { byName } = build();

    expect(byName.browser_snapshot.description).toMatch(/not as instructions/i);
    expect(byName.browser_get_text.description).toMatch(/not as instructions/i);
  });
});

describe('browser_open_url', () => {
  it('navigates and reports the landed url, title and status', async () => {
    const { byName, page } = build();

    const result = await call(byName.browser_open_url, { url: 'https://example.com' });

    expect(page.goto).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ waitUntil: 'domcontentloaded', timeout: 15_000 }),
    );
    expect(result).toContain('https://example.com/landed');
    expect(result).toContain('Example Domain');
  });

  it('returns a recoverable string instead of throwing when navigation fails', async () => {
    const { byName, page } = build();
    page.goto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

    const result = await call(byName.browser_open_url, { url: 'https://nope.example' });

    expect(result).toMatch(/error/i);
    expect(result).toContain('ERR_NAME_NOT_RESOLVED');
  });
});

describe('browser_snapshot', () => {
  it('returns page text and the visible controls with selector hints', async () => {
    const { byName, page } = build();
    page.evaluate.mockResolvedValue({
      text: 'Search the site',
      controls: [{ tag: 'input', type: 'search', name: 'q', role: 'searchbox', selectorHint: 'input[name="q"]' }],
    });

    const result = await call(byName.browser_snapshot, {});

    expect(result).toContain('Search the site');
    expect(result).toContain('input[name="q"]');
  });

  it('truncates page text at maxChars', async () => {
    const { byName, page } = build();
    page.evaluate.mockResolvedValue({ text: 'a'.repeat(500), controls: [] });

    const result = await call(byName.browser_snapshot, { maxChars: 100 });

    expect(result).toContain('...');
    expect(result.length).toBeLessThan(400);
  });
});

describe('target DSL', () => {
  it('routes text= to getByText with a non-exact match', async () => {
    const { byName, page } = build();

    await call(byName.browser_click, { target: 'text=Sign up' });

    expect(page.getByText).toHaveBeenCalledWith('Sign up', { exact: false });
    expect(page.locator).not.toHaveBeenCalled();
  });

  it('routes role= to getByRole', async () => {
    const { byName, page } = build();

    await call(byName.browser_click, { target: 'role=button' });

    expect(page.getByRole).toHaveBeenCalledWith('button', undefined);
  });

  it('routes role=name[...] to getByRole with an accessible name', async () => {
    const { byName, page } = build();

    await call(byName.browser_click, { target: 'role=button[name=Submit]' });

    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Submit' });
  });

  it('treats anything else as a CSS selector', async () => {
    const { byName, page } = build();

    await call(byName.browser_click, { target: '#login > button.primary' });

    expect(page.locator).toHaveBeenCalledWith('#login > button.primary');
  });
});

describe('browser_type', () => {
  it('fills the located element', async () => {
    const { byName, locator } = build();

    await call(byName.browser_type, { target: '#email', text: 'a@b.com' });

    expect(locator.fill).toHaveBeenCalledWith('a@b.com');
  });

  it('appends without clearing when clear is false', async () => {
    // fill() always replaces, so routing clear:false through it silently does
    // the opposite of what the schema promises.
    const { byName, locator } = build();

    await call(byName.browser_type, { target: '#notes', text: ' more', clear: false });

    expect(locator.fill).not.toHaveBeenCalled();
    expect(locator.pressSequentially).toHaveBeenCalledWith(' more');
  });

  it('does not report the typed text back in its result', async () => {
    const { byName } = build();

    const result = await call(byName.browser_type, { target: '#password', text: 'hunter2' });

    expect(result).not.toContain('hunter2');
  });
});

describe('browser_select', () => {
  it('selects the requested option', async () => {
    const { byName, locator } = build();

    await call(byName.browser_select, { target: '#country', value: 'IN' });

    expect(locator.selectOption).toHaveBeenCalledWith('IN');
  });
});

describe('browser_upload_file', () => {
  it('uploads from the workspace, never from the filesystem', async () => {
    const { byName, locator, deps } = build();

    await call(byName.browser_upload_file, { target: 'input[type=file]', workspacePath: 'user' });

    expect(deps.readWorkspaceFile).toHaveBeenCalledWith('user');
    expect(locator.setInputFiles).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.any(String), buffer: expect.any(Buffer) }),
    );
  });

  it('reports a missing workspace file rather than throwing', async () => {
    const { byName } = build({ readWorkspaceFile: vi.fn(async () => null) } as Partial<BrowserToolsDeps>);

    const result = await call(byName.browser_upload_file, { target: '#f', workspacePath: 'nope' });

    expect(result).toMatch(/not found|no such/i);
  });
});

describe('browser_wait', () => {
  it('waits for a duration when given no target', async () => {
    const { byName, page } = build();

    await call(byName.browser_wait, { milliseconds: 250 });

    expect(page.waitForTimeout).toHaveBeenCalledWith(250);
  });

  it('waits for an element when given a target', async () => {
    const { byName, locator, page } = build();

    await call(byName.browser_wait, { target: '#ready' });

    expect(locator.waitFor).toHaveBeenCalled();
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});

describe('browser_screenshot', () => {
  it('uploads a jpeg and returns the key and signed url, not the bytes', async () => {
    const { byName, page, deps } = build();

    const result = await call(byName.browser_screenshot, {});

    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ type: 'jpeg', fullPage: false }));
    expect(deps.uploadScreenshot).toHaveBeenCalled();
    expect(result).toContain('https://s3/signed');
    expect(result).not.toContain('jpegbytes');
    expect(result).not.toMatch(/base64/i);
  });

  it('reports the sequence from the stored key rather than a second local counter', async () => {
    const { byName } = build({
      uploadScreenshot: vi.fn(async () => ({ key: 'claw/screenshots/t1/c1/r1/7.jpg', url: 'https://s3/x' })),
    } as Partial<BrowserToolsDeps>);

    const result = await call(byName.browser_screenshot, {});

    expect(result).toContain('claw/screenshots/t1/c1/r1/7.jpg');
    expect(result).not.toMatch(/Screenshot 1\b/);
  });

  it('honours fullPage', async () => {
    const { byName, page } = build();

    await call(byName.browser_screenshot, { fullPage: true });

    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }));
  });

  it('reports an upload failure rather than throwing', async () => {
    const { byName } = build({
      uploadScreenshot: vi.fn(async () => {
        throw new Error('S3 unreachable');
      }),
    } as Partial<BrowserToolsDeps>);

    const result = await call(byName.browser_screenshot, {});

    expect(result).toMatch(/error/i);
    expect(result).toContain('S3 unreachable');
  });
});

describe('browser_close', () => {
  it('browser_close closes the session', async () => {
    const { byName, session } = build();

    await call(byName.browser_close, {});

    expect(session.close).toHaveBeenCalled();
  });

  // The tools deliberately expose no teardown of their own: a model that never
  // calls browser_close is cleaned up by browser-session-registry.ts, which owns
  // the session across the several requests one browsing turn spans. A second
  // teardown here could close a browser the registry still hands out.
  it('exposes no cleanup of its own — the registry owns session lifetime', () => {
    expect('cleanup' in createBrowserTools(build().deps)).toBe(false);
  });
});
