import { getPrismaClient } from '../db/prisma-client';
import type { PrismaClient } from '@prisma/client';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function resolveTenantFolder(tenantId: string, db: PrismaClient = getPrismaClient()): Promise<string> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
  if (!tenant) return tenantId;
  const candidate = tenant.slug || slugify(tenant.name);
  return candidate || tenantId;
}
