import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client + embeddings BEFORE importing the service.
const mockExecuteRaw = vi.fn().mockResolvedValue(1);
const mockQueryRaw = vi.fn().mockResolvedValue([]);
const mockUpsert = vi.fn().mockResolvedValue({});
const mockFindUnique = vi.fn().mockResolvedValue(null);
const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock('@chatbot/shared', () => ({
    getPrismaClient: () => ({
        $executeRaw: mockExecuteRaw,
        $queryRaw: mockQueryRaw,
        clawMemory: { upsert: mockUpsert, findFirst: mockFindUnique, create: mockUpsert, updateMany: mockUpdateMany, deleteMany: mockDeleteMany },
        clawWorkingMemory: { upsert: mockUpsert, findUnique: mockFindUnique },
    }),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('./embeddings', () => ({
    getClawEmbeddings: vi.fn().mockResolvedValue({
        embedQuery: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    }),
}));

import { getMemoryService } from './memory-service';

describe('MemoryService.recall', () => {
    beforeEach(() => {
        mockQueryRaw.mockClear();
        mockQueryRaw.mockResolvedValue([
            { namespace: 'infra/123', key: 'region', value: { fact: 'us-east-1' }, kind: 'SEMANTIC' },
        ]);
    });

    it('returns typed MemoryHit[] and filters by kind', async () => {
        const svc = getMemoryService();
        const hits = await svc.recall({
            tenantId: 't1', userId: 'u1', query: 'where is prod', kinds: ['SEMANTIC'], limit: 5,
        });
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ namespace: 'infra/123', key: 'region', kind: 'SEMANTIC' });
        // vector search path was used (embedding available)
        expect(mockQueryRaw).toHaveBeenCalled();
    });
});

describe('MemoryService.remember', () => {
    it('upserts with an embedding vector and returns the row id', async () => {
        mockQueryRaw.mockClear();
        mockQueryRaw.mockResolvedValueOnce([{ id: 'row-1' }]);
        const svc = getMemoryService();
        const id = await svc.remember({
            tenantId: 't1', userId: 'u1', kind: 'SEMANTIC',
            namespace: ['infra', '123'], key: 'region',
            value: { fact: 'us-east-1', source: 'cli', confidence: 'high' },
        });
        expect(id).toBe('row-1');
        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });
});

describe('MemoryService.recall hit shape', () => {
    it('returns id and distance on vector hits', async () => {
        mockQueryRaw.mockClear();
        mockQueryRaw.mockResolvedValueOnce([
            { id: 'm-1', namespace: 'infra/123', key: 'region', value: { fact: 'us-east-1' }, kind: 'SEMANTIC', distance: 0.12 },
        ]);
        const svc = getMemoryService();
        const hits = await svc.recall({ tenantId: 't1', userId: 'u1', query: 'region', limit: 5 });
        expect(hits[0]).toMatchObject({ id: 'm-1', kind: 'SEMANTIC', distance: 0.12 });
    });
});

describe('MemoryService.supersede', () => {
    it('marks the old row tenant-scoped', async () => {
        const svc = getMemoryService();
        await svc.supersede('t1', 'old-1', 'new-1');
        expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'old-1', tenantId: 't1' },
            data: expect.objectContaining({ supersededById: 'new-1' }),
        }));
    });
});

describe('MemoryService.reinforce', () => {
    it('refreshes TTL and bumps accessCount tenant-scoped', async () => {
        const svc = getMemoryService();
        await svc.reinforce('t1', 'm-1');
        const arg = mockUpdateMany.mock.calls.at(-1)![0];
        expect(arg.where).toEqual({ id: 'm-1', tenantId: 't1' });
        expect(arg.data.accessCount).toEqual({ increment: 1 });
        expect(arg.data.expiresAt).toBeInstanceOf(Date);
    });
});

describe('MemoryService.update', () => {
    it('updates value + embedding via raw SQL when embedding succeeds', async () => {
        mockExecuteRaw.mockClear();
        const svc = getMemoryService();
        await svc.update('t1', 'm-1', { fact: 'refined' });
        expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });
});

describe('MemoryService.listMemories', () => {
    it('returns memories and total from the raw query results', async () => {
        mockQueryRaw.mockClear();
        mockQueryRaw
            .mockResolvedValueOnce([
                { id: 'm-1', tenantId: 't1', userId: 'u1', namespace: 'billing', key: 'invoice-format', value: { fact: 'Net-30 terms' }, kind: 'SEMANTIC', sourceThreadId: null, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(), supersededById: null, supersededAt: null },
            ])
            .mockResolvedValueOnce([{ count: 1n }]);
        const svc = getMemoryService();
        const { memories, total } = await svc.listMemories({ tenantId: 't1' });
        expect(total).toBe(1);
        expect(memories).toHaveLength(1);
        expect(memories[0].key).toBe('invoice-format');
        expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it('defaults total to 0 when the count query returns no rows', async () => {
        mockQueryRaw.mockClear();
        mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        const svc = getMemoryService();
        const { total } = await svc.listMemories({ tenantId: 't1', kinds: ['PROCEDURAL'] });
        expect(total).toBe(0);
    });
});

describe('MemoryService.deleteMemory', () => {
    it('hard-deletes the row tenant-scoped', async () => {
        mockDeleteMany.mockClear();
        const svc = getMemoryService();
        await svc.deleteMemory('t1', 'm-1');
        expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 'm-1', tenantId: 't1' } });
    });
});
