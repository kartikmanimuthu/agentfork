import { describe, it, expect, beforeEach } from 'vitest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { getPrismaClient } from '@chatbot/shared';
import { synthesizeDomainSkills } from './skill-synthesis';

const db = getPrismaClient();
const suffix = Date.now().toString(36);
const TENANT_ID = `test-tenant-skill-synth-${suffix}`;
const USER_ID = `test-claw-skill-synth-${suffix}`;

async function seedMaturedRule(key: string, overrides: Record<string, unknown> = {}) {
  await db.clawMemory.create({
    data: {
      tenantId: TENANT_ID, userId: USER_ID, namespace: 'procedures/billing', key,
      kind: 'PROCEDURAL', accessCount: 5, expiresAt: new Date(Date.now() + 86_400_000),
      value: { instruction: 'Always check the invoice table first', trigger: 'any billing question', evidence: 'a support run found the answer there', confidence: 'high', ...overrides },
    },
  });
}

describe('synthesizeDomainSkills', () => {
  beforeEach(async () => {
    await db.clawSkill.deleteMany({ where: { tenantId: TENANT_ID } });
    await db.clawMemory.deleteMany({ where: { tenantId: TENANT_ID } });
    delete process.env.AUTO_SKILL_CREATION_ENABLED;
    process.env.SKILL_SYNTHESIS_MIN_RULES = '2';
  });

  it('does nothing when fewer than the minimum matured rules exist', async () => {
    await seedMaturedRule('rule-one');
    const model = new FakeListChatModel({ responses: ['should not be called'] });
    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
  });

  it('creates a system skill once enough rules mature, with a code-appended ledger', async () => {
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two', { instruction: 'Escalate refunds over $500', trigger: 'a refund request', evidence: 'policy doc' });
    const distillerJson = JSON.stringify({ name: 'Billing Ops', description: 'Use for billing questions', narrative: '## Purpose\nHelp with billing.\n## When to use\nBilling questions.\n## Workflow guidance\nCheck records.\n## Safety notes\nNone.' });
    const model = new FakeListChatModel({ responses: [distillerJson] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(1);

    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill).toBeTruthy();
    expect(skill!.source).toBe('system');
    expect(skill!.tier).toBe('read-only');
    expect(skill!.isEnabled).toBe(true);
    expect(skill!.content).toContain('## Learned rules & gotchas');
    expect(skill!.content).toContain('Escalate refunds over $500');

    const rules = await db.clawMemory.findMany({ where: { tenantId: TENANT_ID, kind: 'PROCEDURAL' } });
    expect(rules.every((r) => (r.value as { synthesizedIntoSkill?: string }).synthesizedIntoSkill === 'sys-billing')).toBe(true);
  });

  it('never overwrites a user-owned skill at the same slug', async () => {
    await db.clawSkill.create({ data: { tenantId: TENANT_ID, slug: 'sys-billing', name: 'My Own Billing Skill', description: 'hand-written', tier: 'read-only', content: 'do not touch', source: 'user', isEnabled: true } });
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill!.content).toBe('do not touch');
  });

  it('stamps rules but does not refresh content when the system skill is disabled (user veto)', async () => {
    await db.clawSkill.create({ data: { tenantId: TENANT_ID, slug: 'sys-billing', name: 'Billing', description: 'x', tier: 'read-only', content: 'frozen content', source: 'system', isEnabled: false } });
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill!.content).toBe('frozen content');
    const rules = await db.clawMemory.findMany({ where: { tenantId: TENANT_ID, kind: 'PROCEDURAL' } });
    expect(rules.every((r) => (r.value as { synthesizedIntoSkill?: string }).synthesizedIntoSkill === 'sys-billing')).toBe(true);
  });

  it('never throws — a distiller failure resolves to 0', async () => {
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: [] }); // no responses configured → invoke() throws
    await expect(synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model })).resolves.toBe(0);
  });

  it('respects AUTO_SKILL_CREATION_ENABLED=false', async () => {
    process.env.AUTO_SKILL_CREATION_ENABLED = 'false';
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });
    expect(await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model })).toBe(0);
  });
});
