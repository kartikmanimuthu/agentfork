import { describe, it, expect, vi } from 'vitest';
import { AgentAliasService } from './agent-alias-service';

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    agentAlias: {
      create: vi.fn(async (args: any) => ({ id: 'alias-1', ...args.data })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      delete: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    agentVersion: {
      findFirst: vi.fn(async () => ({ id: 'v1', status: 'published', config: {} })),
    },
    agent: {
      findFirst: vi.fn(async () => ({ id: 'agent-1', config: {} })),
    },
    ...overrides,
  };
}

describe('AgentAliasService', () => {
  it('creates an alias', async () => {
    const db = mockDb();
    db.agentAlias.count = vi.fn(async () => 1);
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.createAlias('agent-1', 'dev', 'v1');
    expect(db.agentAlias.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: 'agent-1', name: 'dev', versionId: 'v1', isDefault: false }),
    }));
    expect(result).toMatchObject({ agentId: 'agent-1', name: 'dev', versionId: 'v1' });
  });

  it('sets isDefault to true when it is the first alias', async () => {
    const db = mockDb();
    db.agentAlias.count = vi.fn(async () => 0);
    const service = new AgentAliasService('tenant-1', db as any);
    await service.createAlias('agent-1', 'dev', 'v1');
    expect(db.agentAlias.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isDefault: true }),
    }));
  });

  it('resolves alias to version config', async () => {
    const db = mockDb();
    db.agentAlias.findFirst = vi.fn(async () => ({ id: 'alias-1', versionId: 'v1', version: { id: 'v1', config: { model: 'gpt-4' } } }));
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.resolveAlias('agent-1', 'dev');
    expect(result).toMatchObject({ versionId: 'v1', config: { model: 'gpt-4' } });
  });

  it('resolves default alias when no name provided', async () => {
    const db = mockDb();
    db.agentAlias.findFirst = vi.fn(async () => ({ id: 'alias-1', versionId: 'v1', version: { id: 'v1', config: {} } }));
    const service = new AgentAliasService('tenant-1', db as any);
    const result = await service.resolveAlias('agent-1');
    expect(db.agentAlias.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'agent-1', isDefault: true }),
    }));
    expect(result).toMatchObject({ versionId: 'v1' });
  });
});
