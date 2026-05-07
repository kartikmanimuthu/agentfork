import { describe, it, expect, vi } from 'vitest';
import { KnowledgeBaseAttachmentService } from './kb-attachment-service';

function mockDb() {
  return {
    agentKnowledgeBase: {
      create: vi.fn(async (args: any) => ({ id: 'akb-1', ...args.data })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [
        { id: 'akb-1', agentId: 'agent-1', knowledgeBaseId: 'kb-1', knowledgeBase: { id: 'kb-1', name: 'Docs', status: 'active' } },
      ]),
    },
    knowledgeBase: {
      findFirst: vi.fn(async () => ({ id: 'kb-1', tenantId: 'tenant-1', status: 'active' })),
    },
  };
}

describe('KnowledgeBaseAttachmentService', () => {
  it('attaches a KB', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    const result = await service.attach('agent-1', 'kb-1');
    expect(db.agentKnowledgeBase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { agentId: 'agent-1', knowledgeBaseId: 'kb-1' },
    }));
    expect(result).toMatchObject({ agentId: 'agent-1', knowledgeBaseId: 'kb-1' });
  });

  it('throws if KB does not belong to tenant', async () => {
    const db = mockDb();
    db.knowledgeBase.findFirst = vi.fn(async () => null);
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    await expect(service.attach('agent-1', 'kb-1')).rejects.toThrow('Knowledge base not found');
  });

  it('lists attached KBs', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    const result = await service.findAttached('agent-1');
    expect(db.agentKnowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1' },
      include: { knowledgeBase: true },
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'akb-1', knowledgeBase: { name: 'Docs' } });
  });

  it('detaches a KB', async () => {
    const db = mockDb();
    const service = new KnowledgeBaseAttachmentService('tenant-1', db as any);
    await service.detach('agent-1', 'kb-1');
    expect(db.agentKnowledgeBase.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1', knowledgeBaseId: 'kb-1' },
    }));
  });
});
