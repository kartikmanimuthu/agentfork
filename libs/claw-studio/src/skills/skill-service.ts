/**
 * skill-service.ts — ported from nucleus lib/skill-service.ts. Nucleus reads
 * through a repository abstraction (getSkillRepository()); this port uses
 * Prisma directly (db.clawSkill), matching every other Claw Studio service.
 */

import { getPrismaClient } from '@chatbot/shared';

export type SkillTier = 'read-only' | 'mutation' | 'approval-gated';

export interface SkillMetadata {
  id: string; // == slug
  name: string;
  description: string;
  tier: SkillTier;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadSkills(tenantId: string): Promise<SkillMetadata[]> {
  const rows = await getPrismaClient().clawSkill.findMany({
    where: { tenantId, isEnabled: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((s) => ({ id: s.slug, name: s.name, description: s.description, tier: s.tier as SkillTier }));
}

export async function getSkillById(tenantId: string, slug: string): Promise<SkillMetadata | null> {
  const s = await getPrismaClient().clawSkill.findFirst({ where: { tenantId, slug } });
  return s ? { id: s.slug, name: s.name, description: s.description, tier: s.tier as SkillTier } : null;
}

export async function getSkillContent(tenantId: string, slug: string): Promise<string | null> {
  const s = await getPrismaClient().clawSkill.findFirst({ where: { tenantId, slug } });
  return s && s.isEnabled ? s.content : null;
}

export async function loadAllSkillContent(tenantId: string): Promise<Map<string, string>> {
  const rows = await getPrismaClient().clawSkill.findMany({ where: { tenantId, isEnabled: true } });
  return new Map(rows.map((s) => [s.slug, s.content]));
}

export async function getSkillSummaries(tenantId: string): Promise<string> {
  const skills = await loadSkills(tenantId);
  if (skills.length === 0) return 'No specialized skills available.';
  const summaries = skills.map((s) => `- ${s.id}: ${s.name} - ${s.description}`).join('\n');
  return `Available Skills:\n${summaries}`;
}
