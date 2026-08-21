import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';

vi.mock('./memory-service', () => ({ getMemoryService: vi.fn() }));
vi.mock('../agent/persistence', () => ({ saveMemory: vi.fn() }));
vi.mock('./reconcile', () => ({ reconcileMemories: vi.fn(), reconcileEnabled: vi.fn() }));
vi.mock('@chatbot/shared', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { getMemoryService } from './memory-service';
import { saveMemory } from '../agent/persistence';
import { reconcileMemories, reconcileEnabled } from './reconcile';
import { createMemoryRecallNode, createMemorySaveNode } from './memory-nodes';
import type { MemoryNodeState, MemoryHit } from './types';

const mockSvc = { recall: vi.fn(), remember: vi.fn() };

const baseState = (overrides: Partial<MemoryNodeState> = {}): MemoryNodeState => ({
    messages: [new HumanMessage('what region is prod in?')],
    taskDescription: 'find prod region',
    plan: [], toolResults: [], errors: [], reflection: '', iterationCount: 1, isComplete: false,
    memoryContext: '', memoryStats: null,
    ...overrides,
});

const hit = (over: Partial<MemoryHit> = {}): MemoryHit => ({
    id: 'm1', namespace: 'infra/123', key: 'region', value: { fact: 'x' }, kind: 'SEMANTIC',
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    mockSvc.recall.mockResolvedValue([]);
    mockSvc.remember.mockResolvedValue('row-id');
    vi.mocked(getMemoryService).mockReturnValue(mockSvc as any);
    vi.mocked(saveMemory).mockResolvedValue(undefined);
    vi.mocked(reconcileEnabled).mockReturnValue(false);
    // Recall tests exercise procedural/episodic explicitly per-test; default them off
    // so the "facts only" tests aren't cross-contaminated by the other two recall calls.
    process.env.PROCEDURAL_MEMORY_ENABLED = 'false';
    process.env.EPISODIC_MEMORY_ENABLED = 'false';
});
afterEach(() => {
    delete process.env.PROCEDURAL_MEMORY_ENABLED;
    delete process.env.EPISODIC_MEMORY_ENABLED;
    delete process.env.MEMORY_LOG_VERBOSE;
});

// ─── createMemoryRecallNode ─────────────────────────────────────────────────

describe('createMemoryRecallNode', () => {
    it('skips when store is missing', async () => {
        const node = createMemoryRecallNode({
            reflectorModel: new FakeListChatModel({ responses: ['unused'] }),
            tenantId: 't1', userId: 'u1', store: null,
        });
        const result = await node(baseState());
        expect(result).toEqual({ memoryContext: '', memoryStats: null });
        expect(getMemoryService).not.toHaveBeenCalled();
    });

    it('skips when tenantId is missing', async () => {
        const node = createMemoryRecallNode({
            reflectorModel: new FakeListChatModel({ responses: ['unused'] }),
            tenantId: undefined, userId: 'u1', store: {},
        });
        const result = await node(baseState());
        expect(result).toEqual({ memoryContext: '', memoryStats: null });
        expect(getMemoryService).not.toHaveBeenCalled();
    });

    it('skips when userId is missing', async () => {
        const node = createMemoryRecallNode({
            reflectorModel: new FakeListChatModel({ responses: ['unused'] }),
            tenantId: 't1', userId: undefined, store: {},
        });
        const result = await node(baseState());
        expect(result).toEqual({ memoryContext: '', memoryStats: null });
        expect(getMemoryService).not.toHaveBeenCalled();
    });

    it('skips when there is no human message in state', async () => {
        const node = createMemoryRecallNode({
            reflectorModel: new FakeListChatModel({ responses: ['unused'] }),
            tenantId: 't1', userId: 'u1', store: {},
        });
        const result = await node(baseState({ messages: [new AIMessage('hello')] }));
        expect(result).toEqual({ memoryContext: '', memoryStats: null });
        expect(getMemoryService).not.toHaveBeenCalled();
    });

    it('composes memoryContext from semantic hits kept by the LLM relevance filter', async () => {
        mockSvc.recall.mockResolvedValue([hit({ distance: 0.1 })]);
        const reflectorModel = new FakeListChatModel({
            responses: ['- [infra/123/region] prod is us-east-1'],
        });
        const node = createMemoryRecallNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(baseState());

        expect(result.memoryContext).toBe('- [infra/123/region] prod is us-east-1');
        expect(result.memoryStats).toEqual({
            phase: 'recall', facts: [{ key: 'region', distance: 0.1 }], rules: [], episodes: [], injected: true,
        });
        expect(mockSvc.recall).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: 't1', userId: 'u1', kinds: ['SEMANTIC'], limit: 10 }),
        );
    });

    it('LLM filter returning NONE drops all facts -> empty memoryContext, injected=false', async () => {
        mockSvc.recall.mockResolvedValue([hit({ distance: 0.1 })]);
        const reflectorModel = new FakeListChatModel({ responses: ['NONE'] });
        const node = createMemoryRecallNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(baseState());

        expect(result.memoryContext).toBe('');
        expect(result.memoryStats?.injected).toBe(false);
        // raw hits are still recorded in stats even though nothing was injected
        expect((result.memoryStats as any).facts).toEqual([{ key: 'region', distance: 0.1 }]);
    });

    it('LLM filter throwing falls back to the first 5 raw hits, unfiltered', async () => {
        mockSvc.recall.mockResolvedValue([hit({ value: { fact: 'raw fallback fact' } })]);
        const reflectorModel = { invoke: vi.fn().mockRejectedValue(new Error('llm down')) } as any;
        const node = createMemoryRecallNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(baseState());

        expect(result.memoryContext).toBe('- [infra/123/region] {"fact":"raw fallback fact"}');
        expect(result.memoryStats?.injected).toBe(true);
    });

    it('semantic recall throwing is swallowed -> empty memoryContext, does not throw', async () => {
        mockSvc.recall.mockRejectedValue(new Error('pgvector down'));
        const reflectorModel = new FakeListChatModel({ responses: ['unused'] });
        const node = createMemoryRecallNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(baseState());

        expect(result.memoryContext).toBe('');
        expect(result.memoryStats?.injected).toBe(false);
    });

    it('composes procedural rules and episodes alongside facts, distance-gating out far hits', async () => {
        delete process.env.PROCEDURAL_MEMORY_ENABLED;
        delete process.env.EPISODIC_MEMORY_ENABLED;
        mockSvc.recall.mockImplementation(async (p: any) => {
            if (p.kinds?.[0] === 'SEMANTIC') return [];
            if (p.kinds?.[0] === 'PROCEDURAL') {
                return [
                    hit({
                        id: 'r1', namespace: 'procedures/aws-cli', key: 'paginate', kind: 'PROCEDURAL', distance: 0.2,
                        value: { instruction: 'Always paginate list calls', trigger: 'any AWS CLI list op', evidence: 'e' },
                    }),
                    hit({
                        id: 'r2', namespace: 'procedures/aws-cli', key: 'far-rule', kind: 'PROCEDURAL', distance: 0.9,
                        value: { instruction: 'THIS SHOULD BE FILTERED OUT', trigger: 'irrelevant', evidence: 'e' },
                    }),
                ];
            }
            if (p.kinds?.[0] === 'EPISODIC') {
                return [
                    hit({
                        id: 'e1', namespace: 'episodes', key: 'thread-9', kind: 'EPISODIC', distance: 0.3,
                        value: { context: 'ctx-9', reasoning: 'reason-9', action: 'action-9', outcome: 'outcome-9' },
                    }),
                ];
            }
            return [];
        });
        const reflectorModel = new FakeListChatModel({ responses: ['unused'] });
        const node = createMemoryRecallNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(baseState());

        expect(result.memoryContext).toContain('### Operating rules (learned)');
        expect(result.memoryContext).toContain('Always paginate list calls');
        expect(result.memoryContext).not.toContain('THIS SHOULD BE FILTERED OUT');
        expect(result.memoryContext).toContain('### Past experience');
        expect(result.memoryContext).toContain('**Situation:** ctx-9');
        expect(result.memoryStats).toEqual({
            phase: 'recall',
            facts: [],
            rules: [{ key: 'paginate', distance: 0.2 }],
            episodes: [{ key: 'thread-9', distance: 0.3 }],
            injected: true,
        });
    });
});

// ─── createMemorySaveNode ───────────────────────────────────────────────────

describe('createMemorySaveNode', () => {
    const twoTurnState = (overrides: Partial<MemoryNodeState> = {}) => baseState({
        messages: [new HumanMessage('deploy the service'), new AIMessage('done, deployed to us-east-1')],
        ...overrides,
    });

    it('skips when store is missing', async () => {
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: ['[]'] }),
            tenantId: 't1', userId: 'u1', store: null,
        });
        const result = await node(twoTurnState());
        expect(result).toEqual({ memoryStats: null });
        expect(getMemoryService).not.toHaveBeenCalled();
    });

    it('skips when conversation is too short (< 2 messages)', async () => {
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: ['[]'] }),
            tenantId: 't1', userId: 'u1', store: {},
        });
        const result = await node(baseState({ messages: [new HumanMessage('hi')] }));
        expect(result).toEqual({ memoryStats: null });
    });

    it('no JSON array in extraction response -> zero-stat save, nothing persisted', async () => {
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: ['Nothing worth remembering here.'] }),
            tenantId: 't1', userId: 'u1', store: {},
        });
        const result = await node(twoTurnState());
        expect(result).toEqual({ memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false } });
        expect(saveMemory).not.toHaveBeenCalled();
        expect(mockSvc.remember).not.toHaveBeenCalled();
    });

    it('malformed extraction JSON recovers after one repair retry', async () => {
        const valid = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'prod-region', value: { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' } },
        ]);
        const node = createMemorySaveNode({
            // First response is truncated/invalid JSON; the repair retry gets a valid array.
            reflectorModel: new FakeListChatModel({ responses: ['[{ "namespace": ["infra"], "key": , }]', valid] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState());

        expect(saveMemory).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            memoryStats: { phase: 'save', savedFacts: 1, savedRules: 0, episodeCaptured: false, reconcileActions: undefined },
        });
    });

    it('extraction JSON wrapped in a code fence is parsed without needing a retry', async () => {
        const valid = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'prod-region', value: { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' } },
        ]);
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: ['```json\n' + valid + '\n```'] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState());

        expect(saveMemory).toHaveBeenCalledTimes(1);
        expect(result.memoryStats).toMatchObject({ savedFacts: 1 });
    });

    it('malformed extraction JSON on both the original response and the repair retry falls back to a zero-stat save, does not throw', async () => {
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: ['[{ broken }]', '[{ still broken }]'] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState());

        expect(result).toEqual({
            memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false, reconcileActions: undefined },
        });
        expect(saveMemory).not.toHaveBeenCalled();
    });

    it('extracted items failing validation (low confidence) are dropped -> zero-stat save', async () => {
        const extracted = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'k1', value: { fact: 'low confidence fact', source: 's', confidence: 'low' } },
        ]);
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: [extracted] }),
            tenantId: 't1', userId: 'u1', store: {},
        });
        const result = await node(twoTurnState());
        expect(result).toEqual({ memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false } });
        expect(saveMemory).not.toHaveBeenCalled();
    });

    it('reconcile disabled: valid SEMANTIC item persists via saveMemory, no skill-synthesis side effect', async () => {
        vi.mocked(reconcileEnabled).mockReturnValue(false);
        const extracted = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'prod-region', value: { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' } },
        ]);
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: [extracted] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState());

        expect(saveMemory).toHaveBeenCalledTimes(1);
        expect(saveMemory).toHaveBeenCalledWith(
            't1', 'u1', ['infra', 'a1'], 'prod-region',
            { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' },
        );
        expect(reconcileMemories).not.toHaveBeenCalled();
        // No PROCEDURAL write and no extra recall/remember beyond the single SEMANTIC saveMemory call
        // proves synthesizeDomainSkills() (proceduralMemoryEnabled() is true by default) is a true no-op.
        expect(mockSvc.remember).not.toHaveBeenCalled();
        expect(mockSvc.recall).not.toHaveBeenCalled();
        expect(result).toEqual({
            memoryStats: { phase: 'save', savedFacts: 1, savedRules: 0, episodeCaptured: false, reconcileActions: undefined },
        });
    });

    it('reconcile disabled: valid PROCEDURAL item persists via getMemoryService().remember with kind PROCEDURAL', async () => {
        vi.mocked(reconcileEnabled).mockReturnValue(false);
        const extracted = JSON.stringify([
            {
                kind: 'PROCEDURAL', namespace: ['procedures', 'aws-cli'], key: 'paginate',
                value: { instruction: 'Always paginate list calls', trigger: 'any AWS CLI list op', evidence: 'missed a resource', confidence: 'high' },
            },
        ]);
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: [extracted] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState());

        expect(mockSvc.remember).toHaveBeenCalledTimes(1);
        expect(mockSvc.remember).toHaveBeenCalledWith({
            tenantId: 't1', userId: 'u1', kind: 'PROCEDURAL',
            namespace: ['procedures', 'aws-cli'], key: 'paginate',
            value: { instruction: 'Always paginate list calls', trigger: 'any AWS CLI list op', evidence: 'missed a resource', confidence: 'high' },
        });
        expect(saveMemory).not.toHaveBeenCalled();
        expect(result).toEqual({
            memoryStats: { phase: 'save', savedFacts: 0, savedRules: 1, episodeCaptured: false, reconcileActions: undefined },
        });
    });

    it('reconcile enabled: extracted facts are handed to reconcileMemories, not saved directly', async () => {
        vi.mocked(reconcileEnabled).mockReturnValue(true);
        vi.mocked(reconcileMemories).mockResolvedValue({ added: 1, updated: 0, superseded: 0, reinforced: 0, noop: 0, failed: 0 });
        const extracted = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'prod-region', value: { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' } },
        ]);
        const reflectorModel = new FakeListChatModel({ responses: [extracted] });
        const node = createMemorySaveNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(twoTurnState());

        expect(reconcileMemories).toHaveBeenCalledTimes(1);
        expect(reconcileMemories).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', userId: 'u1', judgeModel: reflectorModel, sourceThreadId: undefined,
            facts: [{ kind: undefined, namespace: ['infra', 'a1'], key: 'prod-region', value: { fact: 'prod runs in us-east-1', source: 'discovered', confidence: 'high' } }],
        }));
        expect(saveMemory).not.toHaveBeenCalled();
        expect(result).toEqual({
            memoryStats: {
                phase: 'save', savedFacts: 1, savedRules: 0, episodeCaptured: false,
                reconcileActions: { added: 1, updated: 0, superseded: 0, reinforced: 0, noop: 0, failed: 0 },
            },
        });
    });

    it('extraction model throwing does not crash the node -> zero-stat save', async () => {
        const reflectorModel = { invoke: vi.fn().mockRejectedValue(new Error('llm down')) } as any;
        const node = createMemorySaveNode({ reflectorModel, tenantId: 't1', userId: 'u1', store: {} });

        const result = await node(twoTurnState());

        expect(result).toEqual({
            memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false, reconcileActions: undefined },
        });
        expect(saveMemory).not.toHaveBeenCalled();
        expect(mockSvc.remember).not.toHaveBeenCalled();
    });

    it('no runtimeConfig thread_id -> episode capture never triggers regardless of episodicMemoryEnabled', async () => {
        delete process.env.EPISODIC_MEMORY_ENABLED; // real default: enabled
        const extracted = JSON.stringify([
            { namespace: ['infra', 'a1'], key: 'k', value: { fact: 'f', source: 's', confidence: 'high' } },
        ]);
        const node = createMemorySaveNode({
            reflectorModel: new FakeListChatModel({ responses: [extracted] }),
            tenantId: 't1', userId: 'u1', store: {},
        });

        const result = await node(twoTurnState({ toolResults: [{ toolName: 'exec', output: 'ok', isError: false, iterationIndex: 0 }] }));

        expect(result.memoryStats?.episodeCaptured).toBe(false);
    });
});
