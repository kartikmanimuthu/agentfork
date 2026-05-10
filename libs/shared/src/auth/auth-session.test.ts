import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init: any) => ({ body, status: init?.status }),
  },
}));

vi.mock('../db/prisma-client', () => ({
  getPrismaClient: vi.fn(() => ({
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
    },
  })),
}));

import { getServerSession } from 'next-auth';
import { getAuthSession, getSessionTenantId, getSessionUserId, assertSuperAdmin } from './auth-session';

const mockGetServerSession = vi.mocked(getServerSession);
const mockAuthOptions = {} as any;

describe('getAuthSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session when authenticated', async () => {
    const mockSession = { user: { id: '1', email: 'test@test.com' } };
    mockGetServerSession.mockResolvedValue(mockSession as any);
    const result = await getAuthSession(mockAuthOptions);
    expect(result).toBe(mockSession);
  });

  it('returns null when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await getAuthSession(mockAuthOptions);
    expect(result).toBeNull();
  });
});

describe('getSessionTenantId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tenantId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { tenantId: 'tenant-1' } } as any);
    const result = await getSessionTenantId(mockAuthOptions);
    expect(result).toBe('tenant-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionTenantId(mockAuthOptions)).rejects.toThrow('Unauthenticated');
  });

  it('throws when session has no tenantId', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1' } } as any);
    await expect(getSessionTenantId(mockAuthOptions)).rejects.toThrow('Unauthorized');
  });

  it('throws when session tenant no longer exists', async () => {
    const { getPrismaClient } = await import('../db/prisma-client');
    vi.mocked(getPrismaClient).mockReturnValue({
      tenant: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as any);
    mockGetServerSession.mockResolvedValue({ user: { tenantId: 'deleted-tenant' } } as any);
    await expect(getSessionTenantId(mockAuthOptions)).rejects.toThrow(
      'Unauthorized: tenant no longer exists',
    );
  });
});

describe('getSessionUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns userId when session is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any);
    const result = await getSessionUserId(mockAuthOptions);
    expect(result).toBe('user-1');
  });

  it('throws when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(getSessionUserId(mockAuthOptions)).rejects.toThrow('Unauthenticated');
  });
});

describe('assertSuperAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when user is super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { isSuperAdmin: true } } as any);
    const result = await assertSuperAdmin(mockAuthOptions);
    expect(result).toBeNull();
  });

  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await assertSuperAdmin(mockAuthOptions);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns 403 when user is not super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', isSuperAdmin: false } } as any);
    const result = await assertSuperAdmin(mockAuthOptions);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
