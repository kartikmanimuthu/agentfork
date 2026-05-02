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
import { authorize } from './authorize';

const mockGetServerSession = vi.mocked(getServerSession);

describe('authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await authorize('read', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('returns null (allowed) for super admin', async () => {
    mockGetServerSession.mockResolvedValue({ user: { isSuperAdmin: true } } as any);
    const result = await authorize('delete', 'Settings', {});
    expect(result).toBeNull();
  });

  it('returns 403 when user has no role', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1' } } as any);
    const result = await authorize('read', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns null when Owner reads Chat', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'Chat', {});
    expect(result).toBeNull();
  });

  it('returns 403 when Viewer tries to create Chat', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Viewer' } } as any);
    const result = await authorize('create', 'Chat', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('maps subject type via SUBJECT_TO_MODULE', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'Conversation', {});
    expect(result).toBeNull();
  });

  it('handles manage action (maps to all CRUD)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Member' } } as any);
    const result = await authorize('manage', 'Chat', {});
    expect(result).toBeNull();
  });
});
