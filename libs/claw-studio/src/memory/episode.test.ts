import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./memory-service', () => ({ getMemoryService: vi.fn() }));
vi.mock('@chatbot/shared', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { getMemoryService } from './memory-service';
import {
    captureEpisode, formatEpisodesSection, composeMemoryContext, episodicMemoryEnabled,
} from './episode';
import type { EpisodicValue } from './types';

const mockSvc = { remember: vi.fn() };

const goodEpisode: EpisodicValue = {
    context: 'ECS service stuck in DRAINING',
    reasoning: 'cycle the tasks via force-new-deployment',
    action: 'aws ecs update-service --force-new-deployment',
    outcome: 'SUCCEEDED — service returned to steady state',
};

const distillerReturning = (content: string) =>
    ({ invoke: vi.fn().mockResolvedValue({ content }) }) as any;

const baseParams = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 't1', userId: 'u1', threadId: 'th-9',
    distillerModel: distillerReturning(JSON.stringify(goodEpisode)),
    taskDescription: 'restart stuck ECS service',
    plan: [{ step: 'find service', status: 'completed' }],
    toolResults: [{ toolName: 'execute_command', output: 'service restarted', isError: false }],
    errors: [], reflection: 'looks good', isComplete: true, iterationCount: 3,
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    mockSvc.remember.mockResolvedValue('ep-row-id');
    vi.mocked(getMemoryService).mockReturnValue(mockSvc as any);
});
afterEach(() => { delete process.env.EPISODIC_MEMORY_ENABLED; });

describe('episodicMemoryEnabled', () => {
    it('defaults true; false/0 disable', () => {
        expect(episodicMemoryEnabled()).toBe(true);
        process.env.EPISODIC_MEMORY_ENABLED = 'false';
        expect(episodicMemoryEnabled()).toBe(false);
    });
});

describe('captureEpisode', () => {
    it('distills and saves an EPISODIC memory keyed by thread', async () => {
        const saved = await captureEpisode(baseParams() as any);
        expect(saved).toBe(true);
        expect(mockSvc.remember).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', userId: 'u1', kind: 'EPISODIC',
            namespace: ['episodes'], key: 'thread-th-9', sourceThreadId: 'th-9',
            value: expect.objectContaining({ outcome: goodEpisode.outcome }),
        }));
    });

    it('SKIP → no save, returns false', async () => {
        const saved = await captureEpisode(baseParams({ distillerModel: distillerReturning('SKIP') }) as any);
        expect(saved).toBe(false);
        expect(mockSvc.remember).not.toHaveBeenCalled();
    });

    it('invalid distiller output (missing outcome) → no save, false', async () => {
        const bad = JSON.stringify({ context: 'c', reasoning: 'r', action: 'a' });
        const saved = await captureEpisode(baseParams({ distillerModel: distillerReturning(bad) }) as any);
        expect(saved).toBe(false);
        expect(mockSvc.remember).not.toHaveBeenCalled();
    });

    it('distiller throwing → false, does not throw', async () => {
        const boom = { invoke: vi.fn().mockRejectedValue(new Error('llm down')) } as any;
        const saved = await captureEpisode(baseParams({ distillerModel: boom }) as any);
        expect(saved).toBe(false);
    });

    it('flag off → short-circuits before invoking the distiller', async () => {
        process.env.EPISODIC_MEMORY_ENABLED = 'false';
        const distiller = distillerReturning(JSON.stringify(goodEpisode));
        const saved = await captureEpisode(baseParams({ distillerModel: distiller }) as any);
        expect(saved).toBe(false);
        expect(distiller.invoke).not.toHaveBeenCalled();
    });

    it('distiller returns prose with no JSON object → no save, false', async () => {
        const saved = await captureEpisode(baseParams({
            distillerModel: distillerReturning('I could not distill this run into an episode.'),
        }) as any);
        expect(saved).toBe(false);
        expect(mockSvc.remember).not.toHaveBeenCalled();
    });

    it('remember/save throwing → false, does not throw', async () => {
        mockSvc.remember.mockRejectedValue(new Error('db down'));
        const saved = await captureEpisode(baseParams() as any);
        expect(saved).toBe(false);
    });
});

describe('formatEpisodesSection', () => {
    it("returns '' for empty input", () => {
        expect(formatEpisodesSection([])).toBe('');
    });
    it('renders all four labeled fields', () => {
        const s = formatEpisodesSection([goodEpisode]);
        expect(s).toContain('### Past experience');
        expect(s).toContain(`**Situation:** ${goodEpisode.context}`);
        expect(s).toContain(`**Approach:** ${goodEpisode.reasoning}`);
        expect(s).toContain(`**Actions taken:** ${goodEpisode.action}`);
        expect(s).toContain(`**Outcome:** ${goodEpisode.outcome}`);
    });
});

describe('composeMemoryContext', () => {
    it('facts only → bare facts (legacy shape, no headers added)', () => {
        expect(composeMemoryContext('- [a/b] fact', '')).toBe('- [a/b] fact');
    });
    it('episodes only → episodes section as-is', () => {
        expect(composeMemoryContext('', '### Past experience\nX')).toBe('### Past experience\nX');
    });
    it('both → facts under a Known facts header, then episodes', () => {
        const s = composeMemoryContext('- [a/b] fact', '### Past experience\nX');
        expect(s).toBe('### Known facts\n- [a/b] fact\n\n### Past experience\nX');
    });
    it("both empty → ''", () => {
        expect(composeMemoryContext('', '')).toBe('');
    });
});

describe('composeMemoryContext with procedures (third arg)', () => {
    it('third arg defaults empty — two-arg behavior unchanged', () => {
        expect(composeMemoryContext('- [a/b] fact', '')).toBe('- [a/b] fact');
    });
    it('all three → facts header, procedures, episodes in order', () => {
        const s = composeMemoryContext('- [a/b] fact', '### Past experience\nE', '### Operating rules (learned)\nR');
        expect(s).toBe('### Known facts\n- [a/b] fact\n\n### Operating rules (learned)\nR\n\n### Past experience\nE');
    });
    it('procedures only → section as-is', () => {
        expect(composeMemoryContext('', '', '### Operating rules (learned)\nR')).toBe('### Operating rules (learned)\nR');
    });
    it('procedures + episodes (no facts) → joined, no facts header', () => {
        expect(composeMemoryContext('', '### Past experience\nE', '### Operating rules (learned)\nR'))
            .toBe('### Operating rules (learned)\nR\n\n### Past experience\nE');
    });
    it('facts + procedures (no episodes) → facts header + procedures', () => {
        expect(composeMemoryContext('- f', '', '### Operating rules (learned)\nR'))
            .toBe('### Known facts\n- f\n\n### Operating rules (learned)\nR');
    });
});
