import { describe, it, expect } from 'vitest';
import { createTenantSchema, updateTenantSettingsSchema, tenantSwitchSchema, slugSchema } from './tenant';

describe('slugSchema', () => {
  it('accepts valid slug', () => {
    expect(slugSchema.safeParse('my-org').success).toBe(true);
    expect(slugSchema.safeParse('my-org-123').success).toBe(true);
  });

  it('rejects slug starting with hyphen', () => {
    expect(slugSchema.safeParse('-my-org').success).toBe(false);
  });

  it('rejects slug ending with hyphen', () => {
    expect(slugSchema.safeParse('my-org-').success).toBe(false);
  });

  it('rejects slug with uppercase', () => {
    expect(slugSchema.safeParse('MyOrg').success).toBe(false);
  });

  it('rejects short slug', () => {
    expect(slugSchema.safeParse('ab').success).toBe(false);
  });

  it('rejects long slug', () => {
    expect(slugSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });
});

describe('createTenantSchema', () => {
  it('accepts valid tenant data', () => {
    const result = createTenantSchema.safeParse({ name: 'My Org', slug: 'my-org' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createTenantSchema.safeParse({ name: '', slug: 'my-org' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid slug', () => {
    const result = createTenantSchema.safeParse({ name: 'My Org', slug: 'MyOrg' });
    expect(result.success).toBe(false);
  });
});

describe('updateTenantSettingsSchema', () => {
  it('accepts empty update', () => {
    expect(updateTenantSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts partial update', () => {
    const result = updateTenantSettingsSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('accepts notifications update', () => {
    const result = updateTenantSettingsSchema.safeParse({
      notifications: { scheduleExecutions: true },
    });
    expect(result.success).toBe(true);
  });
});

describe('tenantSwitchSchema', () => {
  it('accepts valid tenantId', () => {
    expect(tenantSwitchSchema.safeParse({ tenantId: 'tenant-123' }).success).toBe(true);
  });

  it('rejects empty tenantId', () => {
    expect(tenantSwitchSchema.safeParse({ tenantId: '' }).success).toBe(false);
  });
});
