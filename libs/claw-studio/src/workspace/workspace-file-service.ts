/**
 * workspace-file-service.ts
 *
 * CRUD for Claw's workspace files, with append-only revision history so a
 * self-authored soul rewrite is always diffable and revertible.
 *
 * `restore` writes the old content as a NEW version rather than rewinding the
 * counter — history stays append-only, and "we restored v2" remains visible.
 */

import type { PrismaClient } from '@prisma/client';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import { WORKSPACE_TEMPLATES } from './templates';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, type WorkspaceFile, type WorkspaceSlug } from './types';

const logger = createLogger('claw-studio:workspace');

export class WorkspaceFileTooLargeError extends Error {
  constructor(slug: WorkspaceSlug, length: number) {
    super(`${slug} is ${length} chars, over the ${SLUG_CHAR_CAPS[slug]} limit`);
    this.name = 'WorkspaceFileTooLargeError';
  }
}

export class WorkspaceFileNotFoundError extends Error {
  constructor(slug: WorkspaceSlug, version?: number) {
    super(version === undefined
      ? `Workspace file "${slug}" does not exist`
      : `Workspace file "${slug}" has no version ${version}`);
    this.name = 'WorkspaceFileNotFoundError';
  }
}

export interface WriteWorkspaceFileOptions {
  updatedBy: 'user' | 'claw';
  reason?: string;
  sourceRunId?: string;
}

export interface WorkspaceRevision {
  version: number;
  updatedBy: string;
  reason: string | null;
  createdAt: Date;
}

const SLUG_ORDER = new Map<string, number>(WORKSPACE_SLUGS.map((slug, i) => [slug, i]));

export class WorkspaceFileService {
  private readonly db: PrismaClient;

  constructor(
    private readonly tenantId: string,
    private readonly clawId: string,
    db?: PrismaClient,
  ) {
    this.db = db ?? getPrismaClient();
  }

  private get ctx() {
    return { tenantId: this.tenantId, clawId: this.clawId };
  }

  async seed(): Promise<void> {
    try {
      await this.db.clawFile.createMany({
        data: WORKSPACE_SLUGS.map((slug) => ({
          tenantId: this.tenantId,
          clawId: this.clawId,
          slug,
          content: WORKSPACE_TEMPLATES[slug],
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      logger.error({ error, ...this.ctx }, 'Failed to seed workspace files');
      throw error;
    }
  }

  /**
   * Refreshes seed content for files nobody has touched, so template improvements
   * reach existing tenants.
   *
   * Guarded on `version === 1`: every write() and restore() increments version, so
   * version 1 means never edited by a human or by Claw. Deliberately does NOT bump
   * the version or write a revision — a seed refresh is not an edit.
   */
  async reseedUnedited(): Promise<void> {
    try {
      const rows = await this.db.clawFile.findMany({ where: { clawId: this.clawId } });
      const stale = rows.filter((row) => {
        const template = WORKSPACE_TEMPLATES[row.slug as WorkspaceSlug];
        return template !== undefined && row.version === 1 && row.content !== template;
      });
      if (stale.length === 0) return;

      await Promise.all(stale.map((row) =>
        this.db.clawFile.update({
          where: { clawId_slug: { clawId: this.clawId, slug: row.slug } },
          data: { content: WORKSPACE_TEMPLATES[row.slug as WorkspaceSlug] },
        }),
      ));
      logger.info(
        { ...this.ctx, slugs: stale.map((r) => r.slug) },
        'Refreshed seed content for unedited workspace files',
      );
    } catch (error) {
      logger.error({ error, ...this.ctx }, 'Failed to reseed unedited workspace files');
      throw error;
    }
  }

  async list(): Promise<WorkspaceFile[]> {
    try {
      const rows = await this.db.clawFile.findMany({ where: { clawId: this.clawId } });
      return rows
        .map((row) => ({
          slug: row.slug as WorkspaceSlug,
          content: row.content,
          version: row.version,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        }))
        .sort((a, b) => (SLUG_ORDER.get(a.slug) ?? 99) - (SLUG_ORDER.get(b.slug) ?? 99));
    } catch (error) {
      logger.error({ error, ...this.ctx }, 'Failed to list workspace files');
      throw error;
    }
  }

  async read(slug: WorkspaceSlug): Promise<WorkspaceFile | null> {
    try {
      const row = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!row) return null;
      return {
        slug,
        content: row.content,
        version: row.version,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      logger.error({ error, ...this.ctx, slug }, 'Failed to read workspace file');
      throw error;
    }
  }

  async asMap(): Promise<Map<WorkspaceSlug, string>> {
    const files = await this.list();
    return new Map(files.map((file) => [file.slug, file.content]));
  }

  async write(
    slug: WorkspaceSlug,
    content: string,
    options: WriteWorkspaceFileOptions,
  ): Promise<WorkspaceFile> {
    if (content.length > SLUG_CHAR_CAPS[slug]) {
      throw new WorkspaceFileTooLargeError(slug, content.length);
    }
    try {
      // One transaction: a version bump without its revision row would lose the
      // ability to revert, which is the whole safety story for self-authoring.
      return await this.db.$transaction(async (tx) => {
        const row = await tx.clawFile.upsert({
          where: { clawId_slug: { clawId: this.clawId, slug } },
          create: {
            tenantId: this.tenantId,
            clawId: this.clawId,
            slug,
            content,
            updatedBy: options.updatedBy,
          },
          update: {
            content,
            updatedBy: options.updatedBy,
            version: { increment: 1 },
          },
        });
        await tx.clawFileRevision.create({
          data: {
            tenantId: this.tenantId,
            fileId: row.id,
            version: row.version,
            content,
            updatedBy: options.updatedBy,
            reason: options.reason ?? null,
            sourceRunId: options.sourceRunId ?? null,
          },
        });
        logger.info(
          { ...this.ctx, slug, version: row.version, updatedBy: options.updatedBy },
          'Wrote workspace file',
        );
        return {
          slug,
          content: row.content,
          version: row.version,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        };
      });
    } catch (error) {
      logger.error({ error, ...this.ctx, slug }, 'Failed to write workspace file');
      throw error;
    }
  }

  async revisions(slug: WorkspaceSlug): Promise<WorkspaceRevision[]> {
    try {
      const file = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!file) return [];
      return await this.db.clawFileRevision.findMany({
        where: { fileId: file.id },
        orderBy: { version: 'desc' },
        select: { version: true, updatedBy: true, reason: true, createdAt: true },
      });
    } catch (error) {
      logger.error({ error, ...this.ctx, slug }, 'Failed to list workspace file revisions');
      throw error;
    }
  }

  async restore(slug: WorkspaceSlug, version: number): Promise<WorkspaceFile> {
    try {
      const file = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!file) throw new WorkspaceFileNotFoundError(slug);
      const revision = await this.db.clawFileRevision.findFirst({
        where: { fileId: file.id, version },
      });
      if (!revision) throw new WorkspaceFileNotFoundError(slug, version);
      return await this.write(slug, revision.content, {
        updatedBy: 'user',
        reason: `Restored version ${version}`,
      });
    } catch (error) {
      logger.error({ error, ...this.ctx, slug, version }, 'Failed to restore workspace file revision');
      throw error;
    }
  }
}

export function getWorkspaceFileService(tenantId: string, clawId: string): WorkspaceFileService {
  return new WorkspaceFileService(tenantId, clawId);
}
