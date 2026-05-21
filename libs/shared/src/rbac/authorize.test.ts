import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init: any) => ({ body, status: init?.status }),
  },
}));

vi.mock('./custom-role-service', () => ({
  getCustomRolePermissions: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { authorize } from './authorize';
import { getCustomRolePermissions } from './custom-role-service';

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetCustomRolePermissions = vi.mocked(getCustomRolePermissions);

describe('authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session exists', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const result = await authorize('read', 'Agent', {});
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
    const result = await authorize('read', 'Agent', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns null when Owner reads Agent', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'Agent', {});
    expect(result).toBeNull();
  });

  it('returns 403 when Viewer tries to create Agent', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Viewer' } } as any);
    const result = await authorize('create', 'Agent', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('maps subject type via SUBJECT_TO_MODULE (InferenceSession -> Agents)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Owner' } } as any);
    const result = await authorize('read', 'InferenceSession', {});
    expect(result).toBeNull();
  });

  it('handles manage action (maps to all CRUD)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: '1', role: 'Member' } } as any);
    const result = await authorize('manage', 'Agent', {});
    expect(result).toBeNull();
  });

  it('checks custom role permissions when role is not predefined', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '1', role: 'CustomRole', tenantId: 't1' },
    } as any);
    mockGetCustomRolePermissions.mockResolvedValue({
      Agents: ['read'],
      Settings: [],
      Users: [],
      Tenants: [],
      KnowledgeBases: [],
      McpServers: [],
      LlmProviders: [],
    });
    const result = await authorize('read', 'Agent', {});
    expect(result).toBeNull();
    expect(mockGetCustomRolePermissions).toHaveBeenCalledWith('CustomRole', 't1');
  });

  it('returns 403 for custom role without matching permission', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: '1', role: 'CustomRole', tenantId: 't1' },
    } as any);
    mockGetCustomRolePermissions.mockResolvedValue(null);
    const result = await authorize('delete', 'Agent', {});
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
