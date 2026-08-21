import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredTool } from '@langchain/core/tools';
import { createFileTools } from './file-tools';
import { WorkspaceFileTooLargeError } from '../workspace/workspace-file-service';
import { SLUG_CHAR_CAPS } from '../workspace/types';

function fakeService(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    list: vi.fn(async () =>
      [...store.entries()].map(([slug, content]) => ({
        slug, content, version: 1, updatedBy: 'user', updatedAt: new Date('2026-07-30'),
      })),
    ),
    read: vi.fn(async (slug: string) =>
      store.has(slug)
        ? { slug, content: store.get(slug)!, version: 1, updatedBy: 'user', updatedAt: new Date() }
        : null,
    ),
    write: vi.fn(async (slug: string, content: string) => {
      if (content.length > (SLUG_CHAR_CAPS as Record<string, number>)[slug]) {
        throw new WorkspaceFileTooLargeError(slug as never, content.length);
      }
      store.set(slug, content);
      return { slug, content, version: 2, updatedBy: 'claw', updatedAt: new Date() };
    }),
  };
}

const byName = (tools: StructuredTool[], name: string) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
};

describe('createFileTools', () => {
  let svc: ReturnType<typeof fakeService>;

  beforeEach(() => {
    svc = fakeService({ soul: 'Terse.', user: 'Name: Omar' });
  });

  it('exposes exactly the four expected tools', () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'edit_workspace_file',
      'list_workspace_files',
      'read_workspace_file',
      'write_workspace_file',
    ]);
  });

  it('lists files with sizes and versions', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    const out = await byName(tools, 'list_workspace_files').invoke({});
    expect(out).toContain('soul');
    expect(out).toContain('user');
  });

  it('reads a file', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    expect(await byName(tools, 'read_workspace_file').invoke({ slug: 'soul' })).toContain('Terse.');
  });

  it('returns a helpful string for an unknown slug rather than throwing', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    const out = await byName(tools, 'read_workspace_file').invoke({ slug: 'memory' });
    expect(out).toMatch(/not a workspace file/i);
  });

  it('writes a free slug and records the grant', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'user' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'Name: Omar. Prefers terse replies.', reason: 'learned preference' });
    expect(out).toMatch(/saved/i);
    // Slug-scoped, and true from construction rather than earned by this write
    // — a bare 'write_workspace_file' grant exempted every other slug too.
    expect(handle.grantedWrites.has('write_workspace_file:user')).toBe(true);
    expect(svc.write).toHaveBeenCalledWith(
      'user',
      'Name: Omar. Prefers terse replies.',
      expect.objectContaining({ updatedBy: 'claw', reason: 'learned preference' }),
    );
  });

  it('refuses a gated slug when mode is user, without throwing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'user' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'New persona.', reason: 'felt like it' });
    expect(out).toMatch(/not permitted/i);
    expect(svc.write).not.toHaveBeenCalled();
    // Free slugs ARE seeded in mode 'user'; what must never appear is a grant
    // for the gated slug this call was refused for.
    expect(handle.grantedWrites.has('write_workspace_file:soul')).toBe(false);
  });

  // BEHAVIOUR REVERSED, deliberately. This used to assert that a persona slug is
  // never pre-granted, so every persona edit raised an approval modal. In practice
  // the gate only ever fired on the case that is never a surprise — the user saying
  // "call yourself X" — and a missed prompt left the file unchanged while the reply
  // implied otherwise. Churn is still bounded by MAX_WRITES_PER_RUN and every write
  // is a revertible ClawFileRevision.
  it('pre-grants a gated slug under mode all, so an asked-for persona edit lands without a modal', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'New persona.', reason: 'user asked' });
    expect(out).toMatch(/saved/i);
    expect(handle.grantedWrites.has('write_workspace_file:soul')).toBe(true);
  });

  it('refuses every write when mode is off', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'off' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'x', reason: 'y' });
    expect(out).toMatch(/disabled/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('edits surgically', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'Name: Omar', newText: 'Name: Omar (terse)', reason: 'refine' });
    expect(svc.store.get('user')).toBe('Name: Omar (terse)');
  });

  it('reports missing oldText instead of guessing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'nope', newText: 'x', reason: 'r' });
    expect(out).toMatch(/not found/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('reports ambiguous oldText instead of editing the wrong occurrence', async () => {
    svc = fakeService({ user: 'foo\nfoo' });
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'foo', newText: 'bar', reason: 'r' });
    expect(out).toMatch(/appears 2 times/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('enforces the per-run write cap', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const write = byName(handle.tools, 'write_workspace_file');
    for (let i = 0; i < 5; i++) {
      await write.invoke({ slug: 'user', content: `v${i}`, reason: 'r' });
    }
    const out = await write.invoke({ slug: 'user', content: 'v6', reason: 'r' });
    expect(out).toMatch(/limit reached/i);
    expect(svc.write).toHaveBeenCalledTimes(5);
  });

  it('surfaces an over-cap write as a message, not a thrown error', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'x'.repeat(SLUG_CHAR_CAPS.soul + 1), reason: 'r' });
    expect(out).toMatch(/over the/i);
  });

  it('stamps sourceRunId onto the revision when supplied', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all', sourceRunId: 'run-9' });
    await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'x', reason: 'r' });
    expect(svc.write).toHaveBeenCalledWith('user', 'x', expect.objectContaining({ sourceRunId: 'run-9' }));
  });
});

describe('grantedWrites — per-slug, seeded up front', () => {
  // Before this, `grantedWrites` started EMPTY and only ever gained the bare
  // string 'write_workspace_file', after a successful free-slug write. Three
  // things were wrong at once:
  //   1. the FIRST write to user/tools/heartbeat prompted, though the whole
  //      point of the free-write set is that Claw recording what it learns
  //      must not nag;
  //   2. every write after that skipped the gate regardless of slug, so a
  //      routine `user` write silently unlocked identity/soul/agents;
  //   3. edit_workspace_file was never granted at all, so it always prompted.
  const svc = () => ({
    list: vi.fn(async () => []),
    read: vi.fn(async () => null),
    write: vi.fn(async () => ({ version: 1 })),
  });

  it('seeds free-write slugs at construction, for BOTH write and edit', () => {
    const { grantedWrites } = createFileTools('t1', 'c1', { service: svc() as never, mode: 'all' });
    for (const slug of ['user', 'tools', 'heartbeat']) {
      expect(grantedWrites.has(`write_workspace_file:${slug}`)).toBe(true);
      expect(grantedWrites.has(`edit_workspace_file:${slug}`)).toBe(true);
    }
  });

  it('grants the persona slugs under mode "all"', () => {
    const { grantedWrites } = createFileTools('t1', 'c1', { service: svc() as never, mode: 'all' });
    for (const slug of ['identity', 'soul', 'agents']) {
      expect(grantedWrites.has(`write_workspace_file:${slug}`)).toBe(true);
      expect(grantedWrites.has(`edit_workspace_file:${slug}`)).toBe(true);
    }
  });

  // The restricted modes are untouched by that widening — this is what keeps
  // `all` from being the only mode that means anything.
  it('still grants no persona slug under mode "user", where they are denied outright', () => {
    const { grantedWrites } = createFileTools('t1', 'c1', { service: svc() as never, mode: 'user' });
    for (const slug of ['identity', 'soul', 'agents']) {
      expect(grantedWrites.has(`write_workspace_file:${slug}`)).toBe(false);
      expect(grantedWrites.has(`edit_workspace_file:${slug}`)).toBe(false);
    }
    // The free slugs are still granted, so `user` mode keeps working as before.
    expect(grantedWrites.has('write_workspace_file:user')).toBe(true);
  });

  it('adds no bare tool-name grant — that is what leaked across slugs', () => {
    const { grantedWrites } = createFileTools('t1', 'c1', { service: svc() as never, mode: 'all' });
    expect(grantedWrites.has('write_workspace_file')).toBe(false);
    expect(grantedWrites.has('edit_workspace_file')).toBe(false);
  });

  it('grants nothing when self-authoring is off', () => {
    const { grantedWrites } = createFileTools('t1', 'c1', { service: svc() as never, mode: 'off' });
    expect(grantedWrites.size).toBe(0);
  });

  // The original cross-slug leak this guards against: one write to a free slug
  // putting the BARE tool name in the set and exempting every other slug with it.
  // Asserted under `user` mode, where the persona slugs are genuinely ungranted, so
  // the test still proves a write cannot reach them — under `all` they are granted
  // up front by design and there would be nothing to leak into.
  it('writing to a free slug does not add a grant for any other slug', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc() as never, mode: 'user' });
    await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'x', reason: 'r' });
    expect(handle.grantedWrites.has('write_workspace_file:soul')).toBe(false);
    expect(handle.grantedWrites.has('write_workspace_file')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Argument spelling: what the model actually sends
// ---------------------------------------------------------------------------
//
// The reported failure. The schema was camelCase-only and the model called this
// with `old_text`/`new_text` — snake_case, matching the tool's own name. Zod
// stripped the unknown keys, the required camelCase ones came through undefined,
// and LangChain threw "Received tool input did not match expected schema" BEFORE
// the handler ran, so no recoverable message could be returned. The agent then
// reported success anyway and the file was never touched.

describe('edit_workspace_file argument spellings', () => {
  let svc: ReturnType<typeof fakeService>;
  beforeEach(() => {
    svc = fakeService({ identity: '- **Name:** Wisp\n', user: 'Name: Omar' });
  });

  it('accepts snake_case, which is what the model sends', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file').invoke({
      slug: 'identity',
      old_text: '- **Name:** Wisp',
      new_text: '- **Name:** clawe',
      reason: 'User requested name change',
    });
    expect(svc.store.get('identity')).toBe('- **Name:** clawe\n');
    expect(out).toMatch(/Saved identity/);
  });

  it('still accepts camelCase, so nothing that already worked breaks', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    await byName(handle.tools, 'edit_workspace_file').invoke({
      slug: 'identity',
      oldText: '- **Name:** Wisp',
      newText: '- **Name:** clawe',
      reason: 'r',
    });
    expect(svc.store.get('identity')).toBe('- **Name:** clawe\n');
  });

  // The exact payload from the reported error, including the invented
  // `replace_all` key the model added of its own accord.
  it('tolerates extra keys the model invents', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    await byName(handle.tools, 'edit_workspace_file').invoke({
      slug: 'identity',
      old_text: '- **Name:** Wisp',
      new_text: '- **Name:** clawe',
      reason: 'User requested name change',
      replace_all: true,
    } as never);
    expect(svc.store.get('identity')).toBe('- **Name:** clawe\n');
  });

  // A genuinely malformed call must come back as a message the model can act on,
  // NOT as a throw that ends the turn — the whole point of the schema change.
  it('returns a recoverable message naming the parameters when text is missing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file').invoke({ slug: 'identity' } as never);
    expect(out).toMatch(/Missing old_text and new_text/);
    expect(out).toMatch(/\{ slug, old_text, new_text, reason \}/);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('names only the parameter that is actually missing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'identity', old_text: '- **Name:** Wisp' } as never);
    expect(out).toMatch(/Missing new_text/);
    expect(out).not.toMatch(/old_text and/);
  });

  // `reason` is optional now (it was required, and a model omitting it would have
  // hit the same validation throw), so a call without one must still save.
  it('saves with a default reason when none is given', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'identity', old_text: '- **Name:** Wisp', new_text: '- **Name:** clawe' } as never);
    expect(svc.write).toHaveBeenCalledWith(
      'identity',
      '- **Name:** clawe\n',
      expect.objectContaining({ reason: 'Edited by Claw' }),
    );
  });
});
