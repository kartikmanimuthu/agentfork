import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { StudioService } from './studio-service';

function makeDb() {
  const clawStudio = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const claw = {
    create: vi.fn(),
  };
  const db = {
    clawStudio,
    claw,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    $executeRaw: vi.fn().mockResolvedValue(0),
  } as unknown as PrismaClient & {
    clawStudio: typeof clawStudio;
    claw: typeof claw;
    $transaction: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  return db;
}

describe('StudioService', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it('provisions a studio and its single claw, returning a one-time password', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    db.clawStudio.create.mockResolvedValue({ id: 'studio_1', studioId: 'claw_abc' });
    db.claw.create.mockResolvedValue({ id: 'claw_1', name: 'Claw' });

    const svc = new StudioService('tenant_1', db);
    const result = await svc.provision();

    expect(result.studioRecordId).toBe('studio_1');
    expect(result.clawId).toBe('claw_1');
    expect(result.studioId).toMatch(/^claw_/);
    expect(result.password).toHaveLength(32);

    // password is hashed, never stored in plaintext
    const createArgs = db.clawStudio.create.mock.calls[0][0].data;
    expect(createArgs.passwordHash).not.toBe(result.password);
    expect(createArgs.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash
    expect(createArgs.tenantId).toBe('tenant_1');
    expect(db.claw.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clawStudioId: 'studio_1' }) }),
    );
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('refuses to provision a second studio for the same tenant', async () => {
    db.clawStudio.findFirst.mockResolvedValue({ id: 'studio_1' });
    const svc = new StudioService('tenant_1', db);
    await expect(svc.provision()).rejects.toThrow(/already exists/i);
    expect(db.clawStudio.create).not.toHaveBeenCalled();
  });

  it('resets the password and returns a new one-time password', async () => {
    db.clawStudio.findFirst.mockResolvedValue({ id: 'studio_1', studioId: 'claw_abc' });
    db.clawStudio.update.mockResolvedValue({ id: 'studio_1' });
    const svc = new StudioService('tenant_1', db);
    const result = await svc.resetPassword();

    expect(result.password).toHaveLength(32);
    expect(result.studioId).toBe('claw_abc');
    expect(result.studioRecordId).toBe('studio_1');
    const updateArgs = db.clawStudio.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'studio_1' });
    expect(updateArgs.data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(updateArgs.data.passwordHash).not.toBe(result.password);
  });

  it('throws when resetting a password for a tenant with no studio', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('tenant_1', db);
    await expect(svc.resetPassword()).rejects.toThrow(/no studio/i);
  });

  it('returns a masked summary (never the hash) for the tenant', async () => {
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1',
      studioId: 'claw_abc',
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01'),
      passwordHash: '$2b$10$secret',
      claws: [{ id: 'claw_1', name: 'Claw' }],
    });
    const svc = new StudioService('tenant_1', db);
    const summary = await svc.getForTenant();

    expect(summary).toEqual({
      id: 'studio_1',
      studioId: 'claw_abc',
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01'),
      claw: { id: 'claw_1', name: 'Claw' },
    });
    expect(JSON.stringify(summary)).not.toContain('passwordHash');
  });

  it('returns null when the tenant has no studio', async () => {
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('tenant_1', db);
    expect(await svc.getForTenant()).toBeNull();
  });
});

describe('StudioService.authenticate', () => {
  it('returns the studio context for a correct studioId + password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1', studioId: 'claw_abc', passwordHash, tenantId: 'tenant_1',
      status: 'active', claws: [{ id: 'claw_1' }],
    });
    db.clawStudio.update.mockResolvedValue({});
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    const result = await svc.authenticate('claw_abc', 'correct-horse');
    expect(result).toEqual({ studioRecordId: 'studio_1', studioId: 'claw_abc', tenantId: 'tenant_1', clawId: 'claw_1' });
    expect(db.clawStudio.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'studio_1' }, data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );
  });

  it('returns null for a wrong password', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue({
      id: 'studio_1', studioId: 'claw_abc', passwordHash, tenantId: 'tenant_1',
      status: 'active', claws: [{ id: 'claw_1' }],
    });
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    expect(await svc.authenticate('claw_abc', 'wrong')).toBeNull();
    expect(db.clawStudio.update).not.toHaveBeenCalled();
  });

  it('returns null for an unknown studioId', async () => {
    const db = makeDb();
    db.clawStudio.findFirst.mockResolvedValue(null);
    const svc = new StudioService('', db as unknown as import('@prisma/client').PrismaClient);
    expect(await svc.authenticate('nope', 'x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Managing existing accounts: rename, and the delete that has to clean up after
// a schema where 20 tenant-scoped tables have no FK to Tenant.
// ---------------------------------------------------------------------------

/** The tenant-scoped Claw tables `deleteAccountForUser` must clear by hand, plus
 *  the non-Claw ones that would orphan identically. */
const ORPHAN_PRONE = [
  'clawScheduledTask', 'clawFileRevision', 'clawFile', 'clawRunEvent', 'clawRun',
  'clawChatSession', 'clawPlaygroundSession', 'clawChannelLink', 'clawSkill',
  'clawWorkingMemory', 'clawMemory', 'llmSemanticCache', 'inferenceSession',
  'sessionAnalytics', 'pausedExecution', 'apiKeyExecution', 'telegramMessage',
  'telegramSession', 'agentWorkflow', 'dashboardWidget',
] as const;

function makeAccountDb() {
  const deleteManys = Object.fromEntries(
    ORPHAN_PRONE.map((m) => [m, { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }]),
  );
  const clawStudio = { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) };
  const userTenantRole = { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) };
  const tenant = { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn().mockResolvedValue({}) };
  const db = {
    ...deleteManys,
    clawStudio,
    userTenantRole,
    tenant,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  } as unknown as PrismaClient & Record<string, { deleteMany: ReturnType<typeof vi.fn> }> & {
    clawStudio: typeof clawStudio;
    userTenantRole: typeof userTenantRole;
    tenant: typeof tenant;
    $transaction: ReturnType<typeof vi.fn>;
  };
  return db;
}

/** Two accounts in different tenants, viewed from tenant_current. */
function twoAccounts(db: ReturnType<typeof makeAccountDb>) {
  db.userTenantRole.findMany.mockResolvedValue([
    { tenantId: 'tenant_current' },
    { tenantId: 'tenant_other' },
  ]);
  db.clawStudio.findMany.mockResolvedValue([
    { id: 'studio_current', studioId: 'claw_a', status: 'active', lastLoginAt: null, createdAt: new Date(), claws: [], tenantId: 'tenant_current', tenant: { name: 'Current' } },
    { id: 'studio_other', studioId: 'claw_b', status: 'active', lastLoginAt: null, createdAt: new Date(), claws: [], tenantId: 'tenant_other', tenant: { name: 'Other' } },
  ]);
}

describe('StudioService.renameAccountForUser', () => {
  let db: ReturnType<typeof makeAccountDb>;
  beforeEach(() => { db = makeAccountDb(); });

  // The label IS the tenant name — that is what listForUser reads back.
  it('renames the tenant', async () => {
    db.clawStudio.findUnique.mockResolvedValue({ id: 'studio_other', tenantId: 'tenant_other' });
    db.userTenantRole.findUnique.mockResolvedValue({ role: 'owner' });
    db.tenant.update.mockResolvedValue({ id: 'tenant_other', name: 'Renamed' });

    const result = await new StudioService('tenant_current', db).renameAccountForUser(
      'studio_other', 'user_1', '  Renamed  ',
    );

    expect(result.tenantName).toBe('Renamed');
    expect(db.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant_other' },
      data: { name: 'Renamed' },
      select: { id: true, name: true },
    });
  });

  it('rejects a blank name without touching the database', async () => {
    await expect(
      new StudioService('tenant_current', db).renameAccountForUser('studio_other', 'user_1', '   '),
    ).rejects.toThrow(/name is required/i);
    expect(db.tenant.update).not.toHaveBeenCalled();
  });

  // A non-member is told "not found", so the endpoint cannot be used to discover
  // which studio ids exist.
  it('reports a non-member’s studio as not found', async () => {
    db.clawStudio.findUnique.mockResolvedValue({ id: 'studio_x', tenantId: 'tenant_theirs' });
    db.userTenantRole.findUnique.mockResolvedValue(null);

    await expect(
      new StudioService('tenant_current', db).renameAccountForUser('studio_x', 'user_1', 'Mine now'),
    ).rejects.toThrow('Studio not found');
    expect(db.tenant.update).not.toHaveBeenCalled();
  });
});

describe('StudioService.deleteAccountForUser', () => {
  let db: ReturnType<typeof makeAccountDb>;
  beforeEach(() => {
    db = makeAccountDb();
    db.clawStudio.findUnique.mockResolvedValue({ id: 'studio_other', tenantId: 'tenant_other' });
    db.userTenantRole.findUnique.mockResolvedValue({ role: 'owner' });
    db.tenant.findUnique.mockResolvedValue({ name: 'Other' });
    twoAccounts(db);
  });

  // The whole reason this method exists: Postgres will not cascade these, and it
  // will not complain either.
  it('clears every tenant-scoped table that has no FK to Tenant', async () => {
    await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');

    for (const model of ORPHAN_PRONE) {
      expect(db[model].deleteMany, `${model} was not cleaned up`).toHaveBeenCalledWith({
        where: { tenantId: 'tenant_other' },
      });
    }
    expect(db.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant_other' } });
  });

  // An orphaned scheduled task keeps firing forever — the sweeper selects by task
  // row and knows nothing about tenants. It must go before anything else.
  it('deletes scheduled tasks first, so none can fire mid-teardown', async () => {
    const order: string[] = [];
    for (const model of ORPHAN_PRONE) {
      db[model].deleteMany.mockImplementation(async () => {
        order.push(model);
        return { count: 0 };
      });
    }
    db.tenant.delete.mockImplementation(async () => {
      order.push('tenant');
      return {};
    });

    await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');

    expect(order[0]).toBe('clawScheduledTask');
    expect(order[order.length - 1]).toBe('tenant');
  });

  it('runs the whole teardown in one transaction', async () => {
    await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reports what it removed, for the audit trail', async () => {
    db.clawMemory.deleteMany.mockResolvedValue({ count: 42 });
    db.clawRun.deleteMany.mockResolvedValue({ count: 7 });

    const result = await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');
    expect(result.deleted.memories).toBe(42);
    expect(result.deleted.runs).toBe(7);
    expect(result.tenantName).toBe('Other');
  });

  // Deleting the tenant the session is scoped to pulls its own ground away.
  it('refuses to delete the tenant currently in use', async () => {
    db.clawStudio.findUnique.mockResolvedValue({ id: 'studio_current', tenantId: 'tenant_current' });

    await expect(
      new StudioService('tenant_current', db).deleteAccountForUser('studio_current', 'user_1'),
    ).rejects.toThrow(/currently using/i);
    expect(db.tenant.delete).not.toHaveBeenCalled();
  });

  // With none left, listForUser returns nothing and the create flow is only
  // reachable from the list they can no longer see.
  it('refuses to delete the last remaining account', async () => {
    db.userTenantRole.findMany.mockResolvedValue([{ tenantId: 'tenant_other' }]);
    db.clawStudio.findMany.mockResolvedValue([
      { id: 'studio_other', studioId: 'claw_b', status: 'active', lastLoginAt: null, createdAt: new Date(), claws: [], tenantId: 'tenant_other', tenant: { name: 'Other' } },
    ]);

    await expect(
      new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1'),
    ).rejects.toThrow(/only Claw Studio account/i);
    expect(db.tenant.delete).not.toHaveBeenCalled();
  });

  it('reports a non-member’s studio as not found and deletes nothing', async () => {
    db.userTenantRole.findUnique.mockResolvedValue(null);

    await expect(
      new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1'),
    ).rejects.toThrow('Studio not found');
    expect(db.tenant.delete).not.toHaveBeenCalled();
    expect(db.clawMemory.deleteMany).not.toHaveBeenCalled();
  });
});

describe('StudioService.deleteAccountForUser — a database behind on migrations', () => {
  let db: ReturnType<typeof makeAccountDb>;
  beforeEach(() => {
    db = makeAccountDb();
    db.clawStudio.findUnique.mockResolvedValue({ id: 'studio_other', tenantId: 'tenant_other' });
    db.userTenantRole.findUnique.mockResolvedValue({ role: 'owner' });
    db.tenant.findUnique.mockResolvedValue({ name: 'Other' });
    twoAccounts(db);
  });

  /** Prisma's P2021: the client has a delegate for the model, the database has no
   *  table for it. What actually happened — `llm_semantic_cache` was unmigrated
   *  locally and took the entire delete down with an opaque 500. */
  function tableMissing() {
    return Object.assign(new Error('The table `public.llm_semantic_cache` does not exist'), { code: 'P2021' });
  }

  // The regression this whole block exists for. The original tests mocked every
  // delegate, so they passed whether or not the tables were real — they could
  // never have caught this.
  it('completes the delete when one table does not exist in this database', async () => {
    db.llmSemanticCache.deleteMany.mockRejectedValue(tableMissing());

    const result = await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');

    expect(result.deleted.semanticCache).toBe(0);
    // The point: everything else still went, and the tenant still went.
    expect(db.clawMemory.deleteMany).toHaveBeenCalled();
    expect(db.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant_other' } });
  });

  it('still deletes the tenant when several tables are missing', async () => {
    db.llmSemanticCache.deleteMany.mockRejectedValue(tableMissing());
    db.dashboardWidget.deleteMany.mockRejectedValue(tableMissing());
    db.telegramMessage.deleteMany.mockRejectedValue(tableMissing());

    await new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1');
    expect(db.tenant.delete).toHaveBeenCalled();
  });

  // A missing table is the ONLY thing tolerated. Anything else — a permission
  // failure, a constraint violation, a dropped connection — must abort, or a
  // half-deleted tenant would be reported as a success.
  it('aborts on any error that is not a missing table', async () => {
    db.clawMemory.deleteMany.mockRejectedValue(
      Object.assign(new Error('permission denied for table claw_memories'), { code: 'P2010' }),
    );

    await expect(
      new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1'),
    ).rejects.toThrow(/permission denied/);
    expect(db.tenant.delete).not.toHaveBeenCalled();
  });

  it('aborts on an error carrying no Prisma code at all', async () => {
    db.clawRun.deleteMany.mockRejectedValue(new Error('connection terminated unexpectedly'));

    await expect(
      new StudioService('tenant_current', db).deleteAccountForUser('studio_other', 'user_1'),
    ).rejects.toThrow(/connection terminated/);
    expect(db.tenant.delete).not.toHaveBeenCalled();
  });
});
