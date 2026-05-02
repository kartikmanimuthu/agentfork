import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init: any) => ({ body, status: init?.status }),
  },
}));

import { getServerSession } from 'next-auth';
import { getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth-session';

const mockGetServerSession = vi.mocked(getServerSession);

describe('getSessionTenantId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tenantId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: 'tenant-1' } } as any);
    const result = await getSessionTenantId({});
    expect(result).toBe('tenant-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionTenantId({})).rejects.toThrow('Unauthenticated');
  });

  it('throws when session has no tenantId', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1' } } as any);
    await expect(getSessionTenantId({})).rejects.toThrow('Unauthorized');
  });
});

describe('getSessionUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns userId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any);
    const result = await getSessionUserId({});
    expect(result).toBe('user-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionUserId({})).rejects.toThrow('Unauthenticated');
  });
});

describe('assertSuperAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when user is super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { isSuperAdmin: true } } as any);
    const result = await assertSuperAdmin({});
    expect(result).toBeNull();
  });

  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await assertSuperAdmin({});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 403 when user is not super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', isSuperAdmin: false } } as any);
    const result = await assertSuperAdmin({});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
