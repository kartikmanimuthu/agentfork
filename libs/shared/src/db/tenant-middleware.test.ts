import { describe, it, expect } from 'vitest';
import { TENANT_SCOPED_MODELS } from './tenant-middleware';

describe('TENANT_SCOPED_MODELS', () => {
  it('contains expected models', () => {
    expect(TENANT_SCOPED_MODELS.has('AuditLog')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('CustomRole')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('UserTenantRole')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('TenantConfig')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Invitation')).toBe(true);
  });

  it('does not contain dropped or non-scoped models', () => {
    expect(TENANT_SCOPED_MODELS.has('Conversation')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('User')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('Tenant')).toBe(false);
  });

  it('has exactly 5 models', () => {
    expect(TENANT_SCOPED_MODELS.size).toBe(5);
  });
});

describe('getTenantClient', () => {
  it('throws when tenantId is empty', async () => {
    const { getTenantClient } = await import('./tenant-middleware');
    expect(() => getTenantClient('')).toThrow('tenantId is required');
  });
});
