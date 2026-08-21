import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '@chatbot/shared';
import { slugify, loadSkills, getSkillById, getSkillContent, loadAllSkillContent, getSkillSummaries } from './skill-service';

const db = getPrismaClient();
const suffix = Date.now().toString(36);
const TENANT_ID = `test-tenant-skill-service-${suffix}`;

beforeAll(async () => {
  await db.clawSkill.create({
    data: { tenantId: TENANT_ID, slug: 'billing-basics', name: 'Billing Basics', description: 'When asked about invoices', tier: 'read-only', content: 'Check the invoice table first.', isEnabled: true },
  });
  await db.clawSkill.create({
    data: { tenantId: TENANT_ID, slug: 'disabled-skill', name: 'Disabled Skill', description: 'Should never surface', tier: 'read-only', content: 'secret', isEnabled: false },
  });
});

afterAll(async () => {
  await db.clawSkill.deleteMany({ where: { tenantId: TENANT_ID } });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and strips non-alphanumerics', () => {
    expect(slugify('Cost Analyser!')).toBe('cost-analyser');
    expect(slugify('  Multi   Word  ')).toBe('multi-word');
  });
});

describe('loadSkills', () => {
  it('returns only enabled skills for the tenant', async () => {
    const skills = await loadSkills(TENANT_ID);
    expect(skills.map((s) => s.id)).toEqual(['billing-basics']);
  });
});

describe('getSkillById / getSkillContent', () => {
  it('returns metadata and content for an enabled skill', async () => {
    expect(await getSkillById(TENANT_ID, 'billing-basics')).toMatchObject({ id: 'billing-basics', name: 'Billing Basics' });
    expect(await getSkillContent(TENANT_ID, 'billing-basics')).toBe('Check the invoice table first.');
  });

  it('returns null content for a disabled skill (veto)', async () => {
    expect(await getSkillContent(TENANT_ID, 'disabled-skill')).toBeNull();
  });
});

describe('loadAllSkillContent', () => {
  it('maps enabled skill slugs to content only', async () => {
    const map = await loadAllSkillContent(TENANT_ID);
    expect(map.get('billing-basics')).toBe('Check the invoice table first.');
    expect(map.has('disabled-skill')).toBe(false);
  });
});

describe('getSkillSummaries', () => {
  it('formats an enabled-only catalog', async () => {
    const summary = await getSkillSummaries(TENANT_ID);
    expect(summary).toContain('- billing-basics: Billing Basics - When asked about invoices');
    expect(summary).not.toContain('disabled-skill');
  });

  it('reports no skills for a tenant with none', async () => {
    expect(await getSkillSummaries('tenant-with-no-skills')).toBe('No specialized skills available.');
  });
});
