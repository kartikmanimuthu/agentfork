import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '@chatbot/shared';
import { createLoadSkillTool } from './skill-tool';

// Integration-style, against the real (migrated) local dev Postgres — matches
// memory-tools.test.ts's established pattern (vi.mock does not reliably
// intercept relative-module imports in this package; see that file's comment).
const db = getPrismaClient();
const suffix = Date.now().toString(36);
const TENANT_ID = `test-tenant-skill-tool-${suffix}`;

beforeAll(async () => {
  await db.clawSkill.create({
    data: { tenantId: TENANT_ID, slug: 'billing-basics', name: 'Billing Basics', description: 'x', tier: 'read-only', content: 'Do the thing carefully.', isEnabled: true },
  });
});

afterAll(async () => {
  await db.clawSkill.deleteMany({ where: { tenantId: TENANT_ID } });
});

describe('createLoadSkillTool', () => {
  it('returns the wrapped skill content when found and enabled', async () => {
    const skillTool = createLoadSkillTool(TENANT_ID);
    const result = await skillTool.invoke({ skill_id: 'billing-basics' } as never);
    expect(String(result)).toContain('SKILL LOADED: BILLING-BASICS');
    expect(String(result)).toContain('Do the thing carefully.');
  });

  it('returns an error message with the catalog when the skill is missing or disabled', async () => {
    const skillTool = createLoadSkillTool(TENANT_ID);
    const result = await skillTool.invoke({ skill_id: 'nope' } as never);
    expect(String(result)).toContain('not found or not enabled');
    expect(String(result)).toContain('Available Skills');
    expect(String(result)).toContain('billing-basics');
  });
});
