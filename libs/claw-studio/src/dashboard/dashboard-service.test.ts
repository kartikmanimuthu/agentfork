import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  clawMemory: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  clawSkill: { count: vi.fn() },
  mcpServer: { count: vi.fn() },
  clawRun: { count: vi.fn() },
  clawScheduledTask: { count: vi.fn() },
  llmProvider: { count: vi.fn(), findFirst: vi.fn() },
  auditLog: { findMany: vi.fn(), groupBy: vi.fn() },
};

vi.mock('@chatbot/shared', () => ({
  getPrismaClient: vi.fn(() => db),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn(),
  EncryptionService: vi.fn(),
}));

const mockGetMasked = vi.fn();
vi.mock('../connectors/config-service', () => ({
  ClawConnectorConfigService: vi.fn().mockImplementation(() => ({ getMasked: mockGetMasked })),
}));

vi.mock('../connectors/registry', () => ({
  getConnectorRegistry: vi.fn(() => ({
    list: () => [{ channelType: 'slack' }, { channelType: 'telegram' }],
  })),
}));

import {
  getHeroZone,
  getReadinessZone,
  getMemoryZone,
  getAttentionZone,
  getActivityZone,
  getDashboard,
} from './dashboard-service';

const T = 'tenant-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMasked.mockResolvedValue({ configured: false, enabled: false, fields: {} });
});

describe('getHeroZone', () => {
  it('reports counts and the default provider', async () => {
    db.clawMemory.count.mockResolvedValue(20);
    db.clawSkill.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    db.mcpServer.count.mockResolvedValue(1);
    db.llmProvider.findFirst.mockResolvedValue({
      name: 'Bedrock',
      providerType: 'BEDROCK',
      chatModel: 'us.anthropic.claude-sonnet-5',
    });

    expect(await getHeroZone(T)).toEqual({
      memories: 20,
      skillsEnabled: 2,
      skillsTotal: 3,
      activeTools: 1,
      provider: { name: 'Bedrock', providerType: 'BEDROCK', chatModel: 'us.anthropic.claude-sonnet-5' },
    });
  });

  it('returns a null provider rather than a fabricated one when none is default', async () => {
    db.clawMemory.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    db.llmProvider.findFirst.mockResolvedValue(null);

    expect((await getHeroZone(T)).provider).toBeNull();
  });

  it('scopes every query to the tenant', async () => {
    db.clawMemory.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    db.llmProvider.findFirst.mockResolvedValue(null);

    await getHeroZone(T);

    for (const call of [
      ...db.clawMemory.count.mock.calls,
      ...db.clawSkill.count.mock.calls,
      ...db.mcpServer.count.mock.calls,
      ...db.llmProvider.findFirst.mock.calls,
    ]) {
      expect(call[0].where.tenantId).toBe(T);
    }
  });
});

describe('getReadinessZone', () => {
  it('marks items done from real counts and totals them', async () => {
    db.llmProvider.count.mockResolvedValue(1);
    db.clawSkill.count.mockResolvedValue(2);
    db.mcpServer.count.mockResolvedValue(1);
    // No connector enabled.
    const zone = await getReadinessZone(T);

    expect(zone.total).toBe(4);
    expect(zone.completed).toBe(3);
    expect(zone.items.find((i) => i.id === 'connectors')!.done).toBe(false);
    expect(zone.items.find((i) => i.id === 'provider')!.done).toBe(true);
  });

  it('links each item to its own settings page, not a copy-pasted neighbor', async () => {
    // Regression: 'provider' previously linked to '/connectors' (copied from the
    // 'connectors' item below it), so clicking "Default LLM provider" on the
    // dashboard sent the user to the wrong settings page.
    db.llmProvider.count.mockResolvedValue(1);
    db.clawSkill.count.mockResolvedValue(1);
    db.mcpServer.count.mockResolvedValue(1);
    const zone = await getReadinessZone(T);

    const hrefById: Record<string, string> = {
      provider: '/llm-providers',
      skills: '/skills',
      tools: '/mcp',
      connectors: '/connectors',
    };
    for (const [id, href] of Object.entries(hrefById)) {
      expect(zone.items.find((i) => i.id === id)?.href, `item "${id}"`).toBe(href);
    }
  });

  it('counts a connector as ready only when enabled, not merely configured', async () => {
    db.llmProvider.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    mockGetMasked.mockResolvedValue({ configured: true, enabled: false, fields: {} });

    const zone = await getReadinessZone(T);
    expect(zone.items.find((i) => i.id === 'connectors')!.done).toBe(false);
    expect(zone.completed).toBe(0);
  });

  it('survives a connector whose secret cannot be decrypted', async () => {
    db.llmProvider.count.mockResolvedValue(1);
    db.clawSkill.count.mockResolvedValue(1);
    db.mcpServer.count.mockResolvedValue(1);
    mockGetMasked.mockRejectedValue(new Error('ENCRYPTION_KEY missing'));

    const zone = await getReadinessZone(T);
    expect(zone.completed).toBe(3);
    expect(zone.items.find((i) => i.id === 'connectors')!.done).toBe(false);
  });
});

describe('getMemoryZone', () => {
  function seedMemory(trend: Date[]) {
    db.clawMemory.count.mockResolvedValue(20);
    db.clawMemory.groupBy.mockResolvedValue([
      { kind: 'PROCEDURAL', _count: 7 },
      { kind: 'SEMANTIC', _count: 12 },
      { kind: 'EPISODIC', _count: 1 },
    ]);
    db.clawMemory.findMany
      .mockResolvedValueOnce([{ id: 'm1', key: 'refund-policy', kind: 'SEMANTIC', accessCount: 34 }])
      .mockResolvedValueOnce(trend.map((createdAt) => ({ createdAt })));
  }

  it('sorts kinds by count descending', async () => {
    seedMemory([]);
    const zone = await getMemoryZone(T, '30d');
    expect(zone.byKind.map((k) => k.kind)).toEqual(['SEMANTIC', 'PROCEDURAL', 'EPISODIC']);
    expect(zone.byKind[0].count).toBe(12);
  });

  it('buckets the write trend per day, ascending, omitting empty days', async () => {
    seedMemory([
      new Date('2026-07-27T10:00:00Z'),
      new Date('2026-07-27T18:00:00Z'),
      new Date('2026-07-25T09:00:00Z'),
    ]);
    const zone = await getMemoryZone(T, '30d');
    expect(zone.writeTrend).toEqual([
      { day: '2026-07-25', count: 1 },
      { day: '2026-07-27', count: 2 },
    ]);
  });

  it('flags truncation when the trend hits the row cap', async () => {
    db.clawMemory.count.mockResolvedValue(9000);
    db.clawMemory.groupBy.mockResolvedValue([]);
    db.clawMemory.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 5000 }, () => ({ createdAt: new Date() })));

    expect((await getMemoryZone(T, '90d')).truncated).toBe(true);
  });

  it('does not flag truncation below the cap', async () => {
    seedMemory([new Date()]);
    expect((await getMemoryZone(T, '7d')).truncated).toBe(false);
  });

  it('exposes the memory key, never only the id', async () => {
    seedMemory([]);
    const [top] = (await getMemoryZone(T, '30d')).topAccessed;
    expect(top.key).toBe('refund-policy');
    expect(top.accessCount).toBe(34);
  });
});

describe('getAttentionZone', () => {
  it('totals the groups', async () => {
    db.clawMemory.count.mockResolvedValue(3);
    db.mcpServer.count.mockResolvedValue(1);
    db.clawSkill.count.mockResolvedValue(2);
    // Call order within getAttentionZone's Promise.all: pendingApprovals, then failedRuns.
    db.clawRun.count.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    db.clawScheduledTask.count.mockResolvedValue(1);

    const zone = await getAttentionZone(T, '30d');
    expect(zone.total).toBe(3 + 1 + 2 + 4 + 5 + 1);
    expect(zone.groups).toHaveLength(6);
  });

  it('returns zero groups with empty copy when everything is clear', async () => {
    db.clawMemory.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.clawRun.count.mockResolvedValue(0);
    db.clawScheduledTask.count.mockResolvedValue(0);

    const zone = await getAttentionZone(T, '30d');
    expect(zone.total).toBe(0);
    // Every group still carries actionable copy so a clean state reads as checked.
    expect(zone.groups.every((g) => g.emptyCopy.length > 0 && g.href.length > 0)).toBe(true);
  });

  it('looks ahead for expiring memories rather than counting already-expired ones', async () => {
    db.clawMemory.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.clawRun.count.mockResolvedValue(0);
    db.clawScheduledTask.count.mockResolvedValue(0);

    await getAttentionZone(T, '30d');
    const where = db.clawMemory.count.mock.calls[0][0].where;
    expect(where.expiresAt.lte.getTime()).toBeGreaterThan(Date.now());
  });

  it('bounds failed runs to the selected range, but treats pending approvals and paused tasks as current state', async () => {
    db.clawMemory.count.mockResolvedValue(0);
    db.mcpServer.count.mockResolvedValue(0);
    db.clawSkill.count.mockResolvedValue(0);
    db.clawRun.count.mockResolvedValue(0);
    db.clawScheduledTask.count.mockResolvedValue(0);

    await getAttentionZone(T, '7d');

    const [pendingApprovalsCall, failedRunsCall] = db.clawRun.count.mock.calls;
    expect(pendingApprovalsCall[0].where).toEqual({ tenantId: T, status: 'awaiting_approval' });
    expect(failedRunsCall[0].where.status).toBe('failed');
    expect(failedRunsCall[0].where.createdAt.gte.getTime()).toBeLessThan(Date.now());

    expect(db.clawScheduledTask.count.mock.calls[0][0].where).toEqual({ tenantId: T, status: 'paused' });
  });
});

describe('getActivityZone', () => {
  it('maps entries and serialises timestamps', async () => {
    db.auditLog.findMany.mockResolvedValue([
      {
        id: 'a1',
        eventType: 'claw.connector.updated',
        action: 'Updated Claw Connector',
        severity: 'high',
        status: 'success',
        userId: 'user@example.com',
        createdAt: new Date('2026-07-28T10:00:00Z'),
      },
    ]);
    db.auditLog.groupBy.mockResolvedValue([{ severity: 'high', _count: 1 }]);

    const zone = await getActivityZone(T, '30d');
    expect(zone.recent[0]).toEqual({
      id: 'a1',
      eventType: 'claw.connector.updated',
      action: 'Updated Claw Connector',
      severity: 'high',
      status: 'success',
      user: 'user@example.com',
      createdAt: '2026-07-28T10:00:00.000Z',
    });
    expect(zone.bySeverity).toEqual([{ severity: 'high', count: 1 }]);
  });

  it('normalises a missing userId to null', async () => {
    db.auditLog.findMany.mockResolvedValue([
      {
        id: 'a1',
        eventType: 'e',
        action: 'a',
        severity: 'info',
        status: 'success',
        userId: null,
        createdAt: new Date(),
      },
    ]);
    db.auditLog.groupBy.mockResolvedValue([]);

    expect((await getActivityZone(T, '7d')).recent[0].user).toBeNull();
  });
});

describe('getDashboard', () => {
  function seedAll() {
    db.clawMemory.count.mockResolvedValue(20);
    db.clawMemory.groupBy.mockResolvedValue([{ kind: 'SEMANTIC', _count: 20 }]);
    db.clawMemory.findMany.mockResolvedValue([]);
    db.clawSkill.count.mockResolvedValue(2);
    db.mcpServer.count.mockResolvedValue(1);
    db.clawRun.count.mockResolvedValue(0);
    db.clawScheduledTask.count.mockResolvedValue(0);
    db.llmProvider.count.mockResolvedValue(1);
    db.llmProvider.findFirst.mockResolvedValue({ name: 'Bedrock', providerType: 'BEDROCK', chatModel: 'm' });
    db.auditLog.findMany.mockResolvedValue([]);
    db.auditLog.groupBy.mockResolvedValue([]);
  }

  it('returns every zone as ok when all queries succeed', async () => {
    seedAll();
    const payload = await getDashboard(T, '30d');
    expect(payload.range).toBe('30d');
    for (const zone of ['hero', 'readiness', 'memory', 'attention', 'activity'] as const) {
      expect(payload[zone].ok).toBe(true);
    }
  });

  it('isolates a failing zone so the others still render', async () => {
    seedAll();
    // Only the audit queries blow up.
    db.auditLog.findMany.mockRejectedValue(new Error('relation does not exist'));

    const payload = await getDashboard(T, '30d');
    expect(payload.activity.ok).toBe(false);
    expect(payload.activity.ok === false && payload.activity.error).toContain('activity');
    expect(payload.hero.ok).toBe(true);
    expect(payload.memory.ok).toBe(true);
  });

  it('defaults the range when none is given', async () => {
    seedAll();
    expect((await getDashboard(T)).range).toBe('30d');
  });
});
