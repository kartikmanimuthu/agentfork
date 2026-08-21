import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFileService, WorkspaceFileTooLargeError } from './workspace-file-service';
import { WORKSPACE_TEMPLATES } from './templates';
import { SLUG_CHAR_CAPS } from './types';

interface Row {
  id: string;
  slug: string;
  content: string;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}

function makeDb() {
  const files = new Map<string, Row>();
  const revisions: Array<Record<string, unknown>> = [];
  let seq = 0;

  const clawFile = {
    findMany: vi.fn(async () => [...files.values()]),
    findUnique: vi.fn(async ({ where }: { where: { clawId_slug: { slug: string } } }) =>
      files.get(where.clawId_slug.slug) ?? null),
    createMany: vi.fn(async ({ data }: { data: Array<{ slug: string; content: string }> }) => {
      for (const row of data) {
        if (files.has(row.slug)) continue;
        files.set(row.slug, {
          id: `f${++seq}`, version: 1, updatedBy: 'user', updatedAt: new Date(), ...row,
        });
      }
      return { count: data.length };
    }),
    update: vi.fn(async ({ where, data }: {
      where: { clawId_slug: { slug: string } };
      data: Record<string, unknown>;
    }) => {
      const slug = where.clawId_slug.slug;
      const existing = files.get(slug)!;
      const next = { ...existing, ...data } as Row;
      files.set(slug, next);
      return next;
    }),
    upsert: vi.fn(async ({ where, create, update }: {
      where: { clawId_slug: { slug: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const slug = where.clawId_slug.slug;
      const existing = files.get(slug);
      const next = existing
        ? { ...existing, ...update, version: existing.version + 1, updatedAt: new Date() }
        : { id: `f${++seq}`, version: 1, updatedAt: new Date(), ...create };
      files.set(slug, next as Row);
      return next as Row;
    }),
  };

  const clawFileRevision = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      revisions.push(data);
      return data;
    }),
    findMany: vi.fn(async () => [...revisions].reverse()),
    findFirst: vi.fn(async ({ where }: { where: { version: number } }) =>
      revisions.find((r) => r.version === where.version) ?? null),
  };

  const db = { clawFile, clawFileRevision } as unknown as {
    clawFile: typeof clawFile;
    clawFileRevision: typeof clawFileRevision;
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  db.$transaction = vi.fn(async (fn) => fn(db));
  return { db, files, revisions };
}

describe('WorkspaceFileService', () => {
  let harness: ReturnType<typeof makeDb>;
  let svc: WorkspaceFileService;

  beforeEach(() => {
    harness = makeDb();
    svc = new WorkspaceFileService('t1', 'c1', harness.db as never);
  });

  it('seeds all six templates', async () => {
    await svc.seed();
    expect(harness.db.clawFile.createMany).toHaveBeenCalledOnce();
    const rows = harness.db.clawFile.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(6);
    expect(rows.find((r: { slug: string }) => r.slug === 'soul')?.content).toBe(WORKSPACE_TEMPLATES.soul);
  });

  it('seeds idempotently', async () => {
    await svc.seed();
    await svc.seed();
    expect(harness.files.size).toBe(6);
  });

  it('exposes files as a slug→content map', async () => {
    await svc.seed();
    const map = await svc.asMap();
    expect(map.get('soul')).toBe(WORKSPACE_TEMPLATES.soul);
    expect(map.size).toBe(6);
  });

  it('returns files in declared display order, not insertion order', async () => {
    await svc.seed();
    const listed = (await svc.list()).map((f) => f.slug);
    expect(listed).toEqual(['identity', 'soul', 'agents', 'user', 'tools', 'heartbeat']);
  });

  it('bumps version and records a revision on write', async () => {
    await svc.seed();
    const result = await svc.write('soul', 'New soul.', { updatedBy: 'claw', reason: 'learned tone' });
    expect(result.version).toBe(2);
    expect(harness.revisions).toHaveLength(1);
    expect(harness.revisions[0]).toMatchObject({
      updatedBy: 'claw', reason: 'learned tone', content: 'New soul.',
    });
  });

  it('rejects content over the slug cap', async () => {
    await svc.seed();
    // Derived from the cap so raising a cap can't silently make this test vacuous.
    const overCap = 'x'.repeat(SLUG_CHAR_CAPS.identity + 1);
    await expect(svc.write('identity', overCap, { updatedBy: 'user' }))
      .rejects.toThrow(WorkspaceFileTooLargeError);
  });

  it('accepts content exactly at the slug cap', async () => {
    await svc.seed();
    const atCap = 'x'.repeat(SLUG_CHAR_CAPS.identity);
    await expect(svc.write('identity', atCap, { updatedBy: 'user' })).resolves.toBeDefined();
  });

  it('restores a revision as a new version rather than rewinding', async () => {
    await svc.seed();
    await svc.write('soul', 'v2 content', { updatedBy: 'user' });
    await svc.write('soul', 'v3 content', { updatedBy: 'user' });
    const restored = await svc.restore('soul', 2);
    expect(restored.content).toBe('v2 content');
    expect(restored.version).toBe(4);
  });

  it('returns null when reading a file that does not exist', async () => {
    expect(await svc.read('soul')).toBeNull();
  });
});

describe('WorkspaceFileService.reseedUnedited', () => {
  let harness: ReturnType<typeof makeDb>;
  let svc: WorkspaceFileService;

  beforeEach(() => {
    harness = makeDb();
    svc = new WorkspaceFileService('t1', 'c1', harness.db as never);
  });

  it('refreshes a file still at version 1 whose content drifted from the template', async () => {
    await svc.seed();
    harness.files.get('soul')!.content = 'an older template';

    await svc.reseedUnedited();

    expect(harness.files.get('soul')!.content).toBe(WORKSPACE_TEMPLATES.soul);
  });

  it('leaves an edited file (version > 1) completely alone', async () => {
    await svc.seed();
    await svc.write('soul', 'MY OWN SOUL', { updatedBy: 'user' });
    expect(harness.files.get('soul')!.version).toBe(2);

    await svc.reseedUnedited();

    expect(harness.files.get('soul')!.content).toBe('MY OWN SOUL');
  });

  it('does not bump the version — a seed refresh is not an edit', async () => {
    await svc.seed();
    harness.files.get('soul')!.content = 'an older template';

    await svc.reseedUnedited();

    expect(harness.files.get('soul')!.version).toBe(1);
  });

  it('writes no revision rows', async () => {
    await svc.seed();
    harness.files.get('soul')!.content = 'an older template';

    await svc.reseedUnedited();

    expect(harness.revisions).toHaveLength(0);
  });

  it('is a no-op when every file already matches its template', async () => {
    await svc.seed();
    await svc.reseedUnedited();
    expect(harness.db.clawFile.update).not.toHaveBeenCalled();
  });
});
