import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('studio-service');

export interface ProvisionResult {
  studioId: string;
  password: string;
  studioRecordId: string;
  clawId: string;
}

export interface ResetPasswordResult {
  password: string;
  studioId: string;
  studioRecordId: string;
}

export interface StudioSummary {
  id: string;
  studioId: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  claw: { id: string; name: string } | null;
}

export interface StudioAuthResult {
  studioRecordId: string;
  studioId: string;
  tenantId: string;
  clawId: string;
}

/** One studio account a user can sign into, plus the tenant that isolates it. */
export interface UserStudioSummary extends StudioSummary {
  tenantId: string;
  tenantName: string;
  /** The tenant this studio lives in is the user's current web-ui tenant. */
  isCurrentTenant: boolean;
}

export interface CreateStudioAccountInput {
  /** Shown in the account list and used as the tenant's name. */
  label: string;
  userId: string;
  email: string;
}

export interface CreateStudioAccountResult extends ProvisionResult {
  tenantId: string;
  tenantName: string;
}

/**
 * Guards a runaway "create account" click and keeps one user from quietly
 * spawning unbounded tenants — each one carries its own memories, providers and
 * scheduled tasks, so they are not free.
 */
export const MAX_STUDIO_ACCOUNTS_PER_USER = 10;

const BCRYPT_COST = 10;

export class StudioService {
  constructor(
    private readonly tenantId: string,
    private readonly db: PrismaClient,
  ) {}

  private generateStudioId(): string {
    return 'claw_' + crypto.randomBytes(9).toString('base64url');
  }

  private generatePassword(): string {
    // 24 random bytes → 32 base64url chars
    return crypto.randomBytes(24).toString('base64url');
  }

  private async hash(password: string): Promise<string> {
    const bcrypt = await import('bcryptjs');
    return bcrypt.hash(password, BCRYPT_COST);
  }

  async provision(): Promise<ProvisionResult> {
    const studioId = this.generateStudioId();
    const password = this.generatePassword();
    const passwordHash = await this.hash(password);

    const { studio, claw } = await this.db.$transaction(async (tx) => {
      // Serialize provisioning per-tenant so concurrent calls can't both create a studio
      // (there is intentionally no DB unique constraint on tenantId — multi-Studio stays possible).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.tenantId}))`;

      const existing = await tx.clawStudio.findFirst({ where: { tenantId: this.tenantId } });
      if (existing) {
        throw new Error('A Claw Studio already exists for this tenant');
      }

      const studio = await tx.clawStudio.create({
        data: {
          tenantId: this.tenantId,
          studioId,
          passwordHash,
          status: 'active',
        },
      });
      const claw = await tx.claw.create({
        data: {
          clawStudioId: studio.id,
          name: 'Claw',
          autoApprove: false,
        },
      });
      return { studio, claw };
    });

    return { studioId, password, studioRecordId: studio.id, clawId: claw.id };
  }

  async resetPassword(): Promise<ResetPasswordResult> {
    const studio = await this.db.clawStudio.findFirst({ where: { tenantId: this.tenantId } });
    if (!studio) {
      throw new Error('No Studio to reset for this tenant');
    }
    const password = this.generatePassword();
    const passwordHash = await this.hash(password);
    await this.db.clawStudio.update({ where: { id: studio.id }, data: { passwordHash } });
    return { password, studioId: studio.studioId, studioRecordId: studio.id };
  }

  async getForTenant(): Promise<StudioSummary | null> {
    const studio = await this.db.clawStudio.findFirst({
      where: { tenantId: this.tenantId },
      include: { claws: true },
    });
    if (!studio) return null;
    const first = studio.claws[0] ?? null;
    return {
      id: studio.id,
      studioId: studio.studioId,
      status: studio.status,
      lastLoginAt: studio.lastLoginAt,
      createdAt: studio.createdAt,
      claw: first ? { id: first.id, name: first.name } : null,
    };
  }

  /**
   * Every studio account the user can sign into, across all tenants they belong
   * to (`UserTenantRole`, which is already many-to-many).
   *
   * Deliberately driven from the user's memberships rather than from
   * `this.tenantId`: the whole point of multiple accounts is that they live in
   * DIFFERENT tenants, so a tenant-scoped query would only ever return the one
   * the user happens to be viewing chatflow as.
   */
  async listForUser(userId: string): Promise<UserStudioSummary[]> {
    const memberships = await this.db.userTenantRole.findMany({
      where: { userId },
      select: { tenantId: true },
    });
    const tenantIds = memberships.map((m) => m.tenantId);
    if (!tenantIds.length) return [];

    const studios = await this.db.clawStudio.findMany({
      where: { tenantId: { in: tenantIds } },
      include: { claws: true, tenant: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return studios.map((studio) => {
      const first = studio.claws[0] ?? null;
      return {
        id: studio.id,
        studioId: studio.studioId,
        status: studio.status,
        lastLoginAt: studio.lastLoginAt,
        createdAt: studio.createdAt,
        claw: first ? { id: first.id, name: first.name } : null,
        tenantId: studio.tenantId,
        tenantName: studio.tenant.name,
        isCurrentTenant: studio.tenantId === this.tenantId,
      };
    });
  }

  /**
   * Creates an additional, FULLY ISOLATED studio account: its own tenant, the
   * membership that lets this user reach it, the studio credentials and the
   * Claw itself — all in one transaction.
   *
   * A new tenant rather than a second studio row under the existing one,
   * because every part of Claw (memories, LLM providers, skills, MCP servers,
   * workspace files, scheduled tasks) is keyed on `tenantId`. Two studios
   * sharing a tenant would share all of that, which is not what a separate
   * account means — and `resolveClawRuntime` resolves the studio by tenant, so
   * they would also fight over which Claw answers.
   *
   * The password is returned ONCE and only ever stored hashed; there is no way
   * to read it back, only to reset it.
   */
  async createAccountForUser(input: CreateStudioAccountInput): Promise<CreateStudioAccountResult> {
    const label = input.label.trim();
    if (!label) throw new Error('An account name is required');

    const existing = await this.db.userTenantRole.count({ where: { userId: input.userId } });
    if (existing >= MAX_STUDIO_ACCOUNTS_PER_USER) {
      throw new Error(`You can have at most ${MAX_STUDIO_ACCOUNTS_PER_USER} Claw Studio accounts`);
    }

    const studioId = this.generateStudioId();
    const password = this.generatePassword();
    const passwordHash = await this.hash(password);

    const { tenant, studio, claw } = await this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: label, status: 'active' } });
      // 'owner' — the creator is the only member of a tenant that exists purely
      // to hold their studio, so anything less would lock them out of their own
      // account's settings.
      await tx.userTenantRole.create({
        data: {
          userId: input.userId,
          tenantId: tenant.id,
          email: input.email,
          role: 'owner',
          assignedBy: input.userId,
        },
      });
      const studio = await tx.clawStudio.create({
        data: { tenantId: tenant.id, studioId, passwordHash, status: 'active' },
      });
      const claw = await tx.claw.create({
        data: { clawStudioId: studio.id, name: 'Claw', autoApprove: false },
      });
      return { tenant, studio, claw };
    });

    return {
      studioId,
      password,
      studioRecordId: studio.id,
      clawId: claw.id,
      tenantId: tenant.id,
      tenantName: tenant.name,
    };
  }

  /**
   * Resets by studio record id, after confirming the caller is a member of that
   * studio's tenant — the tenant-scoped `resetPassword()` above cannot reach a
   * user's OTHER accounts, since those live in other tenants.
   */
  async resetPasswordForUser(studioRecordId: string, userId: string): Promise<ResetPasswordResult> {
    const studio = await this.db.clawStudio.findUnique({ where: { id: studioRecordId } });
    if (!studio) throw new Error('Studio not found');

    const membership = await this.db.userTenantRole.findUnique({
      where: { userId_tenantId: { userId, tenantId: studio.tenantId } },
    });
    if (!membership) throw new Error('Studio not found');

    const password = this.generatePassword();
    const passwordHash = await this.hash(password);
    await this.db.clawStudio.update({ where: { id: studio.id }, data: { passwordHash } });
    return { password, studioId: studio.studioId, studioRecordId: studio.id };
  }

  /**
   * Renames an account. The label IS the tenant's name — `listForUser` reads
   * `tenant.name` — so there is nothing else to keep in step.
   *
   * Membership is the authorisation, exactly as in `resetPasswordForUser`: this
   * reaches the user's OTHER tenants, where the current tenant's RBAC does not
   * apply, so a non-member gets the same "not found" a bad id does rather than a
   * 403 that would confirm the account exists.
   */
  async renameAccountForUser(
    studioRecordId: string,
    userId: string,
    label: string,
  ): Promise<{ studioRecordId: string; tenantId: string; tenantName: string }> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('An account name is required');

    const studio = await this.db.clawStudio.findUnique({ where: { id: studioRecordId } });
    if (!studio) throw new Error('Studio not found');
    await this.assertMember(userId, studio.tenantId);

    const tenant = await this.db.tenant.update({
      where: { id: studio.tenantId },
      data: { name: trimmed },
      select: { id: true, name: true },
    });
    logger.info({ userId, tenantId: tenant.id, studioRecordId }, 'Renamed a Claw Studio account');
    return { studioRecordId: studio.id, tenantId: tenant.id, tenantName: tenant.name };
  }

  /**
   * Deletes an account: its tenant and everything keyed to it.
   *
   * **Why this cannot just be `tenant.delete()`.** Thirty-one tenant-scoped
   * models declare `onDelete: Cascade` to Tenant, but TWENTY do not — they carry
   * a bare `tenantId String` with no foreign key at all, eleven of them Claw's
   * own (memories, files, runs, chat sessions, skills, scheduled tasks…). With no
   * FK there is nothing for Postgres to cascade and nothing to raise: deleting the
   * tenant SUCCEEDS and silently leaves every one of those rows behind, keyed to a
   * tenant id that no longer resolves.
   *
   * `ClawScheduledTask` is the one that turns a storage leak into a live incident.
   * The sweeper selects due tasks by task row and knows nothing about tenants, so
   * an orphaned task keeps firing on its schedule indefinitely, trying to resolve a
   * runtime for a deleted tenant. That is why it is deleted FIRST, in the same
   * transaction — a task must not be able to fire against a half-deleted tenant.
   *
   * Irreversible. Callers are expected to confirm before reaching this.
   */
  async deleteAccountForUser(
    studioRecordId: string,
    userId: string,
  ): Promise<{ tenantId: string; tenantName: string; deleted: Record<string, number> }> {
    const studio = await this.db.clawStudio.findUnique({ where: { id: studioRecordId } });
    if (!studio) throw new Error('Studio not found');
    await this.assertMember(userId, studio.tenantId);

    // Deleting the tenant you are currently operating as would pull the session's
    // own ground out from under it — every subsequent request resolves a tenant
    // that no longer exists, and the user cannot even reach the page to recover.
    if (studio.tenantId === this.tenantId) {
      throw new Error('You cannot delete the account you are currently using. Switch to another account first.');
    }

    // Leaving the user with none would strand them: `listForUser` returns nothing,
    // and the create flow is reachable only from the list they can no longer see.
    const accounts = await this.listForUser(userId);
    if (accounts.length <= 1) {
      throw new Error('You cannot delete your only Claw Studio account.');
    }

    const tenant = await this.db.tenant.findUnique({
      where: { id: studio.tenantId },
      select: { name: true },
    });
    const tenantId = studio.tenantId;
    const scope = { where: { tenantId } };
    const deleted: Record<string, number> = {};

    /**
     * Deletes from one table, tolerating a table this database does not have yet.
     *
     * Prisma's client carries a delegate for every model in `schema.prisma`, but a
     * database only has the tables its APPLIED migrations created. A deployment
     * (or a developer's local DB) sitting behind on migrations therefore has
     * delegates for tables that do not exist, and `deleteMany` raises P2021 —
     * which aborts the whole transaction and makes deleting ANY account fail with
     * an opaque error. That is exactly what happened: `llm_semantic_cache` was
     * absent locally and took the entire delete down with it.
     *
     * A missing table holds no rows, so skipping it removes nothing and orphans
     * nothing — the only honest outcome. Logged at warn, because a table missing
     * in production means migrations are behind and someone should know. Every
     * other error still propagates and still rolls the transaction back: a
     * permission failure or a constraint violation must NOT be mistaken for
     * "nothing to delete".
     */
    const clear = async (model: string, del: () => Promise<{ count: number }>): Promise<number> => {
      try {
        return (await del()).count;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === 'P2021') {
          logger.warn(
            { ...{ tenantId }, model },
            'Skipped a table that does not exist in this database — migrations are behind',
          );
          return 0;
        }
        throw error;
      }
    };

    await this.db.$transaction(async (tx) => {
      // FIRST, for the reason in the doc comment above: no scheduled task may
      // survive to fire against a tenant that is being torn down.
      deleted.scheduledTasks = await clear('clawScheduledTask', () => tx.clawScheduledTask.deleteMany(scope));

      // ClawFileRevision and ClawRunEvent DO cascade from their parents
      // (ClawFile / ClawRun), but both also carry their own tenantId, so they are
      // deleted explicitly and before those parents. Doing it in this order keeps
      // the counts honest rather than reporting zero for rows the cascade removed.
      deleted.fileRevisions = await clear('clawFileRevision', () => tx.clawFileRevision.deleteMany(scope));
      deleted.files = await clear('clawFile', () => tx.clawFile.deleteMany(scope));
      deleted.runEvents = await clear('clawRunEvent', () => tx.clawRunEvent.deleteMany(scope));
      deleted.runs = await clear('clawRun', () => tx.clawRun.deleteMany(scope));
      deleted.chatSessions = await clear('clawChatSession', () => tx.clawChatSession.deleteMany(scope));
      deleted.playgroundSessions = await clear('clawPlaygroundSession', () => tx.clawPlaygroundSession.deleteMany(scope));
      deleted.channelLinks = await clear('clawChannelLink', () => tx.clawChannelLink.deleteMany(scope));
      deleted.skills = await clear('clawSkill', () => tx.clawSkill.deleteMany(scope));
      deleted.workingMemories = await clear('clawWorkingMemory', () => tx.clawWorkingMemory.deleteMany(scope));
      deleted.memories = await clear('clawMemory', () => tx.clawMemory.deleteMany(scope));

      // The other nine FK-less tenant-scoped tables. Not Claw's, but they are
      // keyed on this tenant and would orphan identically.
      deleted.semanticCache = await clear('llmSemanticCache', () => tx.llmSemanticCache.deleteMany(scope));
      deleted.inferenceSessions = await clear('inferenceSession', () => tx.inferenceSession.deleteMany(scope));
      deleted.sessionAnalytics = await clear('sessionAnalytics', () => tx.sessionAnalytics.deleteMany(scope));
      deleted.pausedExecutions = await clear('pausedExecution', () => tx.pausedExecution.deleteMany(scope));
      deleted.apiKeyExecutions = await clear('apiKeyExecution', () => tx.apiKeyExecution.deleteMany(scope));
      deleted.telegramMessages = await clear('telegramMessage', () => tx.telegramMessage.deleteMany(scope));
      deleted.telegramSessions = await clear('telegramSession', () => tx.telegramSession.deleteMany(scope));
      deleted.agentWorkflows = await clear('agentWorkflow', () => tx.agentWorkflow.deleteMany(scope));
      deleted.dashboardWidgets = await clear('dashboardWidget', () => tx.dashboardWidget.deleteMany(scope));

      // Last: takes the studio, the Claw, the memberships and the 31 properly
      // FK-cascaded tables with it.
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    logger.info(
      { userId, tenantId, studioRecordId, deleted },
      'Deleted a Claw Studio account and every row keyed to its tenant',
    );
    return { tenantId, tenantName: tenant?.name ?? '', deleted };
  }

  /** Membership is the authorisation for cross-tenant account operations. A
   *  non-member is told "not found" rather than "forbidden", so the endpoint
   *  cannot be used to probe which studio ids exist. */
  private async assertMember(userId: string, tenantId: string): Promise<void> {
    const membership = await this.db.userTenantRole.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    if (!membership) throw new Error('Studio not found');
  }

  async authenticate(studioId: string, password: string): Promise<StudioAuthResult | null> {
    const studio = (await this.db.clawStudio.findFirst({
      where: { studioId, status: 'active' },
      include: { claws: true },
    })) as
      | { id: string; studioId: string; passwordHash: string; tenantId: string; claws: { id: string }[] }
      | null;
    if (!studio) return null;

    const bcrypt = await import('bcryptjs');
    const ok = await bcrypt.compare(password, studio.passwordHash);
    if (!ok) return null;

    const claw = studio.claws[0];
    if (!claw) return null;

    await this.db.clawStudio.update({ where: { id: studio.id }, data: { lastLoginAt: new Date() } });

    return { studioRecordId: studio.id, studioId: studio.studioId, tenantId: studio.tenantId, clawId: claw.id };
  }
}
