import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./memory-service', () => ({ getMemoryService: vi.fn() }));

// reconcile.ts logs judge verdicts via the shared Pino logger (repo mandate) rather
// than console.* (nucleus original). mockLogger is a stable object (not a new one
// per createLogger() call) so the "judge verdict logging" tests below can assert
// against the structured log calls the module under test actually made.
// vi.hoisted is required: vi.mock factories are hoisted above const declarations.
const { mockLogger } = vi.hoisted(() => ({
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@chatbot/shared', () => ({ createLogger: () => mockLogger }));

import { getMemoryService } from './memory-service';
import { reconcileMemories, reconcileEnabled } from './reconcile';
import type { ExtractedFact } from './types';

const mockSvc = {
    recall: vi.fn(),
    remember: vi.fn(),
    update: vi.fn(),
    supersede: vi.fn(),
    reinforce: vi.fn(),
};

const fact = (key: string): ExtractedFact => ({
    namespace: ['infra', 'a1'], key,
    value: { fact: `${key} fact`, source: 's', confidence: 'high' },
});
const neighbor = (id: string, distance = 0.1) => ({
    id, namespace: 'infra/a1', key: 'existing', value: { fact: 'old' }, kind: 'SEMANTIC', distance,
});
const judgeReturning = (json: unknown) => ({
    invoke: vi.fn().mockResolvedValue({ content: JSON.stringify(json) }),
}) as any;
const base = { tenantId: 't1', userId: 'u1', sourceThreadId: 'th-1' };

beforeEach(() => {
    vi.clearAllMocks();
    mockSvc.recall.mockResolvedValue([]);
    mockSvc.remember.mockResolvedValue('new-id');
    mockSvc.update.mockResolvedValue(undefined);
    mockSvc.supersede.mockResolvedValue(undefined);
    mockSvc.reinforce.mockResolvedValue(undefined);
    vi.mocked(getMemoryService).mockReturnValue(mockSvc as any);
});
afterEach(() => { delete process.env.MEMORY_RECONCILE_ENABLED; });

describe('reconcileEnabled', () => {
    it('defaults true; false/0 disable', () => {
        expect(reconcileEnabled()).toBe(true);
        process.env.MEMORY_RECONCILE_ENABLED = 'false';
        expect(reconcileEnabled()).toBe(false);
    });
});

describe('reconcileMemories', () => {
    it('no near neighbors → ADD without calling the judge', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('far-1', 0.9)]); // beyond threshold
        const judge = judgeReturning([]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(judge.invoke).not.toHaveBeenCalled();
        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
        expect(summary.added).toBe(1);
    });

    it('SUPERSEDE → remember new then supersede old with the new id', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'SUPERSEDE', targetId: 'old-1' }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
        expect(mockSvc.supersede).toHaveBeenCalledWith('t1', 'old-1', 'new-id');
        expect(summary.superseded).toBe(1);
    });

    it('REINFORCE → reinforce only, no new row', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'REINFORCE', targetId: 'old-1' }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.reinforce).toHaveBeenCalledWith('t1', 'old-1');
        expect(mockSvc.remember).not.toHaveBeenCalled();
        expect(summary.reinforced).toBe(1);
    });

    it('UPDATE → update target with mergedValue', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const merged = { fact: 'merged', source: 's', confidence: 'high' };
        const judge = judgeReturning([{ factIndex: 0, action: 'UPDATE', targetId: 'old-1', mergedValue: merged }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.update).toHaveBeenCalledWith('t1', 'old-1', merged);
        expect(summary.updated).toBe(1);
    });

    it('NOOP → nothing written', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'NOOP' }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.remember).not.toHaveBeenCalled();
        expect(summary.noop).toBe(1);
    });

    it('judge throws → ADD fallback', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = { invoke: vi.fn().mockRejectedValue(new Error('boom')) } as any;
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
        expect(summary.added).toBe(1);
    });

    it('invalid targetId → ADD fallback', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'SUPERSEDE', targetId: 'not-a-neighbor' }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.supersede).not.toHaveBeenCalled();
        expect(summary.added).toBe(1);
    });

    it('one fact failing does not block its sibling', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        mockSvc.reinforce.mockRejectedValueOnce(new Error('db down'));
        const judge = judgeReturning([
            { factIndex: 0, action: 'REINFORCE', targetId: 'old-1' },
            { factIndex: 1, action: 'NOOP' },
        ]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1'), fact('k2')], judgeModel: judge });
        expect(summary.failed).toBe(1);
        expect(summary.noop).toBe(1);
    });

    it('recall throwing → fact treated as no-neighbors → ADD, judge not called', async () => {
        mockSvc.recall.mockRejectedValue(new Error('pgvector down'));
        const judge = judgeReturning([]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(judge.invoke).not.toHaveBeenCalled();
        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
        expect(summary.added).toBe(1);
    });

    it('judge returning decisions for only some facts → missing ones fall back to ADD', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'NOOP' }]); // nothing for factIndex 1
        const summary = await reconcileMemories({ ...base, facts: [fact('k1'), fact('k2')], judgeModel: judge });
        expect(summary.noop).toBe(1);
        expect(summary.added).toBe(1);
        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
    });

    it('judge invoked exactly once for multiple neighbor-bearing facts', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([
            { factIndex: 0, action: 'NOOP' },
            { factIndex: 1, action: 'NOOP' },
        ]);
        await reconcileMemories({ ...base, facts: [fact('k1'), fact('k2')], judgeModel: judge });
        expect(judge.invoke).toHaveBeenCalledTimes(1);
    });

    it('UPDATE with array mergedValue is rejected → ADD fallback', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'UPDATE', targetId: 'old-1', mergedValue: ['not-an-object'] }]);
        const summary = await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.update).not.toHaveBeenCalled();
        expect(summary.added).toBe(1);
    });

    const proceduralFact = (key: string): ExtractedFact => ({
        kind: 'PROCEDURAL', namespace: ['procedures', 'aws-cli'], key,
        value: { instruction: 'always paginate', trigger: 'list ops', evidence: 'missed items', confidence: 'high' } as any,
    });

    it('procedural fact → neighbors fetched with kinds PROCEDURAL and ADD saves kind PROCEDURAL', async () => {
        mockSvc.recall.mockResolvedValue([]); // no neighbors → fast-path ADD
        const judge = judgeReturning([]);
        await reconcileMemories({ ...base, facts: [proceduralFact('paginate')], judgeModel: judge });
        expect(mockSvc.recall).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['PROCEDURAL'] }));
        expect(mockSvc.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'PROCEDURAL' }));
    });

    it('procedural SUPERSEDE → new row saved with kind PROCEDURAL', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-rule')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'SUPERSEDE', targetId: 'old-rule' }]);
        await reconcileMemories({ ...base, facts: [proceduralFact('paginate')], judgeModel: judge });
        expect(mockSvc.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'PROCEDURAL' }));
        expect(mockSvc.supersede).toHaveBeenCalledWith('t1', 'old-rule', 'new-id');
    });

    it('kind absent → SEMANTIC everywhere (legacy default)', async () => {
        mockSvc.recall.mockResolvedValue([]);
        const judge = judgeReturning([]);
        await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockSvc.recall).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['SEMANTIC'] }));
        expect(mockSvc.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'SEMANTIC' }));
    });
});

// Nucleus logs judge verdicts via console.log; this port logs via the shared Pino
// logger instead (repo mandate — see reconcile.ts). These three cases are adapted
// to spy on the mocked logger's structured call args rather than parsing a console
// string, while verifying the exact same verdict/reason information is surfaced.
describe('judge verdict logging', () => {
    it('logs a SUPERSEDE verdict line with the displaced id', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        const judge = judgeReturning([{ factIndex: 0, action: 'SUPERSEDE', targetId: 'old-1' }]);
        await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judge });
        expect(mockLogger.info.mock.calls.some(
            ([ctx]) => ctx?.action === 'SUPERSEDE' && ctx?.targetId === 'old-1',
        )).toBe(true);
    });

    it('logs fast-path ADD when no near neighbors', async () => {
        mockSvc.recall.mockResolvedValue([]);
        await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judgeReturning([]) });
        expect(mockLogger.info.mock.calls.some(
            ([ctx]) => ctx?.action === 'ADD' && ctx?.reason === 'no near neighbors',
        )).toBe(true);
    });

    it('logs fallback ADD when the judge returns no decision for a fact', async () => {
        mockSvc.recall.mockResolvedValue([neighbor('old-1')]);
        await reconcileMemories({ ...base, facts: [fact('k1')], judgeModel: judgeReturning([]) });
        expect(mockLogger.info.mock.calls.some(
            ([ctx]) => ctx?.action === 'ADD' && ctx?.reason === 'no decision returned',
        )).toBe(true);
    });
});
