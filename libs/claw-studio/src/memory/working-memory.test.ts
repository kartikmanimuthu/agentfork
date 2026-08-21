import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { workingMemoryEnabled, tokenBudget, keepRecent } from './working-memory';

describe('working-memory config', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('defaults: enabled=true, budget=60000, keep=8', () => {
        delete process.env.WORKING_MEMORY_ENABLED;
        delete process.env.WORKING_MEMORY_TOKEN_BUDGET;
        delete process.env.WORKING_MEMORY_KEEP_RECENT;
        expect(workingMemoryEnabled()).toBe(true);
        expect(tokenBudget()).toBe(60000);
        expect(keepRecent()).toBe(8);
    });

    it('WORKING_MEMORY_ENABLED=false disables', () => {
        process.env.WORKING_MEMORY_ENABLED = 'false';
        expect(workingMemoryEnabled()).toBe(false);
    });

    it('reads numeric overrides', () => {
        process.env.WORKING_MEMORY_TOKEN_BUDGET = '30000';
        process.env.WORKING_MEMORY_KEEP_RECENT = '4';
        expect(tokenBudget()).toBe(30000);
        expect(keepRecent()).toBe(4);
    });
});

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import fc from 'fast-check';
import {
    estimateTokens, estimateMessagesTokens, compressToolOutput,
    selectWindow, buildWorkingMemorySection, emptyScratchpad,
} from './working-memory';

describe('estimateTokens', () => {
    it('is ceil(len/4)', () => {
        expect(estimateTokens('12345678')).toBe(2);
        expect(estimateTokens('123')).toBe(1);
        expect(estimateTokens('')).toBe(0);
    });
});

describe('compressToolOutput', () => {
    it('keeps head+tail with an elision marker when over the cap', () => {
        const big = 'A'.repeat(500) + 'B'.repeat(500);
        const out = compressToolOutput(big, 200);
        expect(out.length).toBeLessThan(big.length);
        expect(out).toContain('elided');
        expect(out.startsWith('A')).toBe(true);
        expect(out.endsWith('B')).toBe(true);
    });
    it('returns short content unchanged', () => {
        expect(compressToolOutput('short', 200)).toBe('short');
    });
});

describe('selectWindow', () => {
    it('always keeps at least the last `keep` messages', () => {
        const msgs = Array.from({ length: 20 }, (_, i) => new HumanMessage(`m${i}`));
        const win = selectWindow(msgs, 1, 5); // tiny budget
        expect(win.length).toBeGreaterThanOrEqual(5);
    });

    it('property: window is a recency-preserving suffix, keeps >= min(keep,n), and stays within budget once the keep-floor fits', () => {
        fc.assert(fc.property(
            fc.array(fc.string({ minLength: 1, maxLength: 400 }), { minLength: 1, maxLength: 60 }),
            fc.integer({ min: 1, max: 10 }),
            (contents, keep) => {
                // Alternate Human/AI roles + non-empty content so getRecentMessages
                // passes the slice through UNCHANGED. (Two same-role messages adjacent
                // make getRecentMessages inject a synthetic "Acknowledged." AIMessage to
                // satisfy Bedrock adjacency — that repair is getRecentMessages' concern,
                // not selectWindow's, and would grow the array out from under a suffix check.)
                const msgs = contents.map((c, i) =>
                    i % 2 === 0 ? new HumanMessage(`${i}:${c}`) : new AIMessage(`${i}:${c}`),
                );
                const budget = 5000;
                const win = selectWindow(msgs, budget, keep);

                // (1) Floor: never drops below min(keep, n) messages.
                expect(win.length).toBeGreaterThanOrEqual(Math.min(keep, msgs.length));

                // (2) Suffix: the window is exactly the last win.length messages, in order
                //     (getRecentMessages preserves order and, for these non-empty human
                //     messages, does not drop any). This is what "recency-preserving" means.
                const tail = msgs.slice(msgs.length - win.length);
                expect(win.map((m) => m.content)).toEqual(tail.map((m) => m.content));

                // (3) Budget: any message ADDED beyond the keep-floor stays within budget.
                //     (The keep-floor itself may exceed budget by design — that is allowed.)
                if (win.length > keep) {
                    expect(estimateMessagesTokens(win)).toBeLessThanOrEqual(budget);
                }
            },
        ));
    });
});

describe('buildWorkingMemorySection', () => {
    it('returns empty string for null WM', () => {
        expect(buildWorkingMemorySection(null)).toBe('');
    });
    it('renders summary + scratchpad goals', () => {
        const sec = buildWorkingMemorySection({
            runningSummary: 'Investigated ECS.',
            scratchpad: { ...emptyScratchpad(), openGoals: ['restart task'], resourceIds: ['cluster-1'] },
            tokenCount: 100, turnCount: 3,
        });
        expect(sec).toContain('## Working Memory');
        expect(sec).toContain('Investigated ECS.');
        expect(sec).toContain('restart task');
        expect(sec).toContain('cluster-1');
    });
});

import { prepareContext, foldWorkingMemory } from './working-memory';
import { getRecentMessages } from '../agent/agent-shared';
import type { ReflectionState } from '../agent/agent-shared';

function baseState(messages: any[]): ReflectionState {
    return {
        messages, taskDescription: 't', plan: [], code: '', executionOutput: '',
        errors: [], reflection: '', iterationCount: 0, nextAction: 'plan',
        isComplete: false, toolResults: [], memoryContext: '', memoryStats: null,
        runningSummary: '', scratchpad: { openGoals: [], keyFindings: [], resourceIds: [], pendingSteps: [] },
    };
}

const fakeReflector = {
    invoke: async () => ({
        content: JSON.stringify({
            summary: 'Restarted the stuck ECS task.',
            scratchpad: { openGoals: ['verify health'], keyFindings: ['task was OOM'], resourceIds: ['svc-1'], pendingSteps: [] },
        }),
    }),
} as any;

describe('prepareContext', () => {
    afterEach(() => { delete process.env.WORKING_MEMORY_ENABLED; delete process.env.WORKING_MEMORY_TOKEN_BUDGET; });

    it('disabled → falls back to getRecentMessages(fallbackWindow), no WM section, no LLM call', async () => {
        process.env.WORKING_MEMORY_ENABLED = 'false';
        // Alternate roles so getRecentMessages passes the window through unchanged
        // (adjacent same-role messages make it inject synthetic "Acknowledged." AIMessages,
        // which would push the returned length above the fallbackWindow — a getRecentMessages
        // concern, not prepareContext's). Same convention as the selectWindow property test.
        const msgs = Array.from({ length: 30 }, (_, i) =>
            i % 2 === 0 ? new HumanMessage(`m${i}`) : new AIMessage(`m${i}`),
        );
        const res = await prepareContext(baseState(msgs), { reflectorModel: fakeReflector }, 20);
        expect(res.workingMemorySection).toBe('');
        expect(res.stateUpdate).toEqual({});
        // Disabled path returns EXACTLY the legacy getRecentMessages(fallbackWindow) window
        // (identical to today's behavior). Asserting a length bound is wrong: getRecentMessages
        // does not hard-cap at maxMessages — it can add leading/adjacency fixups — so compare to it directly.
        expect(res.windowMessages).toEqual(getRecentMessages(msgs, 20));
    });

    it('enabled + under budget → no compaction, no LLM call, empty stateUpdate', async () => {
        process.env.WORKING_MEMORY_TOKEN_BUDGET = '100000';
        const msgs = [new HumanMessage('hi'), new AIMessage('hello')];
        const res = await prepareContext(baseState(msgs), { reflectorModel: fakeReflector }, 20);
        expect(res.stateUpdate).toEqual({});
        expect(res.windowMessages.length).toBe(2);
    });

    it('enabled + over budget → folds evicted turns into summary + scratchpad', async () => {
        process.env.WORKING_MEMORY_TOKEN_BUDGET = '10'; // force compaction
        const msgs = Array.from({ length: 12 }, (_, i) =>
            i % 2 === 0 ? new HumanMessage('X'.repeat(80) + i) : new AIMessage('X'.repeat(80) + i),
        );
        const res = await prepareContext(baseState(msgs), { reflectorModel: fakeReflector }, 20);
        expect(res.workingMemorySection).toContain('## Working Memory');
        expect(res.workingMemorySection).toContain('Restarted the stuck ECS task.');
        expect(res.stateUpdate.runningSummary).toContain('Restarted');
        expect(res.stateUpdate.scratchpad?.openGoals).toContain('verify health');
    });
});

describe('foldWorkingMemory monotonicity', () => {
    it('never drops a pre-existing open goal', async () => {
        const prev = {
            runningSummary: 'prior', tokenCount: 0, turnCount: 1,
            scratchpad: { openGoals: ['KEEP ME'], keyFindings: [], resourceIds: [], pendingSteps: [] },
        };
        const next = await foldWorkingMemory(prev, [new HumanMessage('did stuff')], fakeReflector);
        expect(next.scratchpad.openGoals).toContain('KEEP ME');   // merged, not replaced
        expect(next.scratchpad.openGoals).toContain('verify health'); // plus the new one
        expect(next.turnCount).toBe(2);
    });
});
