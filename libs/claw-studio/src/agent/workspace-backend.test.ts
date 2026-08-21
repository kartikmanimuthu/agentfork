import { describe, it, expect, beforeEach } from 'vitest';
import { ClawWorkspaceBackend, pathToSlug, slugToPath } from './workspace-backend';
import type { WorkspaceSlug } from '../workspace/types';
import { MAX_WRITES_PER_RUN } from '../workspace/self-authoring-policy';

/** Hand-rolled fake — vi.mock does not reliably intercept relative imports here. */
function fakeService(initial: Partial<Record<WorkspaceSlug, string>> = {}) {
  const store = new Map<WorkspaceSlug, string>(Object.entries(initial) as [WorkspaceSlug, string][]);
  const writes: Array<{ slug: WorkspaceSlug; content: string; options: unknown }> = [];
  return {
    writes,
    async read(slug: WorkspaceSlug) {
      const content = store.get(slug);
      return content === undefined ? null : { slug, content, version: 1 };
    },
    async write(slug: WorkspaceSlug, content: string, options: unknown) {
      store.set(slug, content);
      writes.push({ slug, content, options });
      return { slug, content, version: 2 };
    },
    async list() {
      return [...store.entries()].map(([slug, content]) => ({ slug, content, version: 1 }));
    },
  };
}

describe('path mapping', () => {
  it('maps a slug to a path and back', () => {
    expect(slugToPath('soul')).toBe('/soul.md');
    expect(pathToSlug('/soul.md')).toBe('soul');
  });

  it('rejects a path that is not a workspace slug', () => {
    expect(pathToSlug('/etc/passwd')).toBeNull();
    expect(pathToSlug('/nope.md')).toBeNull();
  });
});

describe('ClawWorkspaceBackend', () => {
  let svc: ReturnType<typeof fakeService>;
  let backend: ClawWorkspaceBackend;

  beforeEach(() => {
    svc = fakeService({ soul: 'I am curious.', identity: 'Claw' });
    backend = new ClawWorkspaceBackend(svc as never, { sourceRunId: 'run_1' });
  });

  it('reads a workspace file by path', async () => {
    expect(await backend.read('/soul.md')).toEqual({ content: 'I am curious.' });
  });

  it('returns an error object rather than throwing for an unknown path', async () => {
    const result = await backend.read('/etc/passwd');
    expect(result.error).toContain('not a Claw workspace file');
    expect(result.content).toBeUndefined();
  });

  it('writes through to the service with audit metadata', async () => {
    const result = await backend.write('/soul.md', 'I am bold.');
    expect(result).toEqual({ path: '/soul.md' });
    expect(svc.writes[0]).toMatchObject({
      slug: 'soul',
      content: 'I am bold.',
      options: { updatedBy: 'claw', sourceRunId: 'run_1' },
    });
  });

  it('rejects content over the slug cap without throwing', async () => {
    const result = await backend.write('/identity.md', 'x'.repeat(2001));
    expect(result.error).toContain('exceeds');
    expect(svc.writes).toHaveLength(0);
  });

  it('lists only files that exist', async () => {
    const result = await backend.ls('/');
    expect(result.files?.map((f) => f.path).sort()).toEqual(['/identity.md', '/soul.md']);
  });

  it('greps across workspace files', async () => {
    const result = await backend.grep('curious');
    // GrepMatch's real fields (node_modules/deepagents/dist/agent-*.d.ts):
    // `path`, `line` (1-indexed number), `text` (the matching line's content) —
    // NOT `line_number`/`line` as the brief guessed.
    expect(result.matches?.[0]).toMatchObject({ path: '/soul.md', line: 1, text: 'I am curious.' });
  });

  it('reports execute as unsupported instead of throwing', async () => {
    const result = await backend.execute('ls');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('not supported');
  });

  it('readRaw returns FileData under `data`, not a bare content field', async () => {
    const result = await backend.readRaw('/soul.md');
    expect(result.data?.content).toBe('I am curious.');
    expect(result.error).toBeUndefined();
  });

  it('edits by string replacement and writes the result through', async () => {
    const result = await backend.edit('/soul.md', 'curious', 'bold');
    // Fix round 2, Important 7 — `occurrences` must be set: the edit_file tool
    // renders "Successfully replaced ${result.occurrences} occurrence(s)".
    expect(result).toEqual({ path: '/soul.md', occurrences: 1 });
    expect(svc.writes[0].content).toBe('I am bold.');
  });

  it('counts every occurrence when replaceAll is true', async () => {
    svc = fakeService({ soul: 'curious curious curious', identity: 'Claw' });
    backend = new ClawWorkspaceBackend(svc as never, { sourceRunId: 'run_1' });
    const result = await backend.edit('/soul.md', 'curious', 'bold', true);
    expect(result).toEqual({ path: '/soul.md', occurrences: 3 });
    expect(svc.writes[0].content).toBe('bold bold bold');
  });

  it('reports a missing edit target instead of throwing', async () => {
    const result = await backend.edit('/soul.md', 'absent-text', 'x');
    expect(result.error).toContain('not found');
    expect(svc.writes).toHaveLength(0);
  });

  // Fix round 2, Important 6 — read() must honour offset/limit (0-indexed
  // line window), not always return the whole file from line 1.
  it('honours offset and limit as a 0-indexed line window', async () => {
    svc = fakeService({ soul: ['one', 'two', 'three', 'four', 'five'].join('\n'), identity: 'Claw' });
    backend = new ClawWorkspaceBackend(svc as never, { sourceRunId: 'run_1' });

    expect(await backend.read('/soul.md', 1, 2)).toEqual({ content: 'two\nthree' });
    expect(await backend.read('/soul.md', 3, 100)).toEqual({ content: 'four\nfive' });
  });

  it('edit() sees the WHOLE file even when it exceeds read()\'s default window', async () => {
    // 600 short lines — over read()'s default 500-line limit. Uses the
    // 'agents' slug (8000-char cap) since 600 lines exceeds 'soul'/'user's
    // 4000-char cap. edit() must still find and replace text past line 500,
    // proving it does not route through the offset/limit-sliced read().
    const lines = Array.from({ length: 600 }, (_, i) => `line-${i}`);
    lines[550] = 'NEEDLE';
    svc = fakeService({ agents: lines.join('\n'), identity: 'Claw' });
    backend = new ClawWorkspaceBackend(svc as never, { sourceRunId: 'run_1' });

    const result = await backend.edit('/agents.md', 'NEEDLE', 'FOUND');
    expect(result).toEqual({ path: '/agents.md', occurrences: 1 });
    expect(svc.writes[0].content.split('\n')[550]).toBe('FOUND');
  });

  // Fix round 3, Critical 2 (remaining item) — MAX_WRITES_PER_RUN was
  // enforced only by file-tools.ts's own custom tools; deepagents' forced
  // write_file/edit_file call THIS backend directly and had no counter at
  // all, so a reflection loop could churn user/tools/heartbeat (the
  // free-write slugs the `permissions` deny rule deliberately leaves open)
  // an unbounded number of times per run.
  describe('write cap (MAX_WRITES_PER_RUN)', () => {
    it('allows writes up to MAX_WRITES_PER_RUN', async () => {
      for (let i = 0; i < MAX_WRITES_PER_RUN; i++) {
        const result = await backend.write('/user.md', `write #${i}`);
        expect(result.error).toBeUndefined();
      }
      expect(svc.writes).toHaveLength(MAX_WRITES_PER_RUN);
    });

    it('rejects the write past the cap, naming it, and never reaches WorkspaceFileService.write', async () => {
      for (let i = 0; i < MAX_WRITES_PER_RUN; i++) {
        await backend.write('/user.md', `write #${i}`);
      }
      const result = await backend.write('/user.md', 'one too many');
      expect(result.error).toContain('Write limit reached');
      expect(result.error).toContain(String(MAX_WRITES_PER_RUN));
      // Still exactly MAX_WRITES_PER_RUN — the rejected call never reached
      // the service, so no new entry was recorded and none was overwritten.
      expect(svc.writes).toHaveLength(MAX_WRITES_PER_RUN);
    });

    it('counts a single edit() call once, not twice, even though edit() calls write() internally', async () => {
      for (let i = 0; i < MAX_WRITES_PER_RUN - 1; i++) {
        await backend.write('/user.md', `write #${i}`);
      }
      // Exactly one slot left — a double-counted edit would exhaust it AND
      // leave the cap already hit for the assertion below; a correctly
      // single-counted edit leaves the cap exactly reached, not exceeded.
      const editResult = await backend.edit('/soul.md', 'curious', 'bold');
      expect(editResult.error).toBeUndefined();
      expect(svc.writes).toHaveLength(MAX_WRITES_PER_RUN);

      const overCap = await backend.write('/user.md', 'over the cap now');
      expect(overCap.error).toContain('Write limit reached');
    });

    it('never throws when the cap is exceeded', async () => {
      for (let i = 0; i < MAX_WRITES_PER_RUN; i++) {
        await backend.write('/user.md', `write #${i}`);
      }
      await expect(backend.write('/user.md', 'one too many')).resolves.not.toThrow();
    });

    it('is scoped per-instance — a second ClawWorkspaceBackend starts fresh', async () => {
      for (let i = 0; i < MAX_WRITES_PER_RUN; i++) {
        await backend.write('/user.md', `write #${i}`);
      }
      const exhausted = await backend.write('/user.md', 'one too many');
      expect(exhausted.error).toContain('Write limit reached');

      const secondSvc = fakeService({ soul: 'fresh', identity: 'Claw' });
      const secondBackend = new ClawWorkspaceBackend(secondSvc as never, { sourceRunId: 'run_2' });
      const result = await secondBackend.write('/user.md', 'first write on a brand-new instance');
      expect(result.error).toBeUndefined();
      expect(secondSvc.writes).toHaveLength(1);
    });
  });
});
