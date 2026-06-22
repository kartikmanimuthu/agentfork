import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('../db/prisma-client', () => ({
  getPrismaClient: () => ({ auditLog: { create: mockCreate } }),
}));

import { AuditService } from './audit-service';

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls repository create with input', async () => {
    mockCreate.mockResolvedValue({ id: '1' });
    await AuditService.log('tenant-1', { eventType: 'login', action: 'read' });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'login',
        action: 'read',
      }),
    });
  });

  it('does not throw when repository create fails', async () => {
    mockCreate.mockRejectedValue(new Error('db error'));
    await expect(
      AuditService.log('tenant-1', { eventType: 'login', action: 'read' }),
    ).resolves.toBeUndefined();
  });
});
