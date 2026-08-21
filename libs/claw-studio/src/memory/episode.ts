/**
 * episode.ts — episodic memory: capture + replay formatting (Phase 3).
 *
 * Capture: distill one cognitive snapshot (context/reasoning/action/outcome)
 * per tool-using run; the distiller may SKIP routine runs; failures are
 * first-class ("what didn't work" is the most valuable experience). One
 * episode per thread (key `thread-<threadId>`), refreshed via the live-unique
 * upsert. Episodes bypass the reconcile judge — they are historical records.
 * Replay: pure formatters that compose episodes into the memoryContext string.
 * Never throws.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger } from '@chatbot/shared';
import { getMemoryService } from './memory-service';
import { compressToolOutput } from './working-memory';
import type { EpisodicValue } from './types';

const logger = createLogger('claw-studio:memory-episode');

export const EPISODE_RECALL_LIMIT = 2;
// Looser than reconcile's 0.55 — an ANALOGOUS past experience is useful even
// when not near-identical. Initial guess — tune from recall logs.
export const EPISODE_DISTANCE_THRESHOLD = 0.65;

export function episodicMemoryEnabled(): boolean {
    const v = process.env.EPISODIC_MEMORY_ENABLED?.toLowerCase();
    return !(v === 'false' || v === '0');
}

export interface CaptureEpisodeParams {
    tenantId: string;
    userId: string;
    threadId: string;
    distillerModel: BaseChatModel;
    taskDescription: string;
    plan: Array<{ step: string; status: string }>;
    toolResults: Array<{ toolName: string; output: string; isError: boolean }>;
    errors: string[];
    reflection: string;
    isComplete: boolean;
    iterationCount: number;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

const DISTILLER_SYSTEM = new SystemMessage(
    `You distill a completed agent run into ONE reusable episode for future few-shot recall.
Return ONLY a JSON object with exactly these four non-empty string fields:
{"context": "...", "reasoning": "...", "action": "...", "outcome": "..."}
- context: the task/situation the agent faced (generalized; drop ephemeral IDs unless essential).
- reasoning: the approach taken and why.
- action: the key tool calls / steps actually executed.
- outcome: whether it SUCCEEDED or FAILED, and why. Failures are valuable — capture what didn't work.
If the run was routine or unremarkable (simple lookups, trivial queries), return exactly: SKIP`,
);

export async function captureEpisode(p: CaptureEpisodeParams): Promise<boolean> {
    if (!episodicMemoryEnabled()) return false;
    try {
        const toolSummary = p.toolResults
            .map((t) => `- ${t.toolName} [${t.isError ? 'ERROR' : 'OK'}]: ${compressToolOutput(t.output, 400)}`)
            .join('\n');
        const planSummary = p.plan.length
            ? p.plan.map((s, i) => `${i + 1}. [${s.status}] ${s.step}`).join('\n')
            : '(no explicit plan)';

        const input = new HumanMessage(
            `**Task:** ${compressToolOutput(p.taskDescription || '(unknown)', 1000)}\n\n` +
            `**Plan:**\n${planSummary}\n\n` +
            `**Tool executions:**\n${compressToolOutput(toolSummary, 4000)}\n\n` +
            `**Errors:** ${p.errors.length ? p.errors.join('; ') : '(none)'}\n\n` +
            `**Reviewer reflection:** ${compressToolOutput(p.reflection || '(none)', 800)}\n\n` +
            `**Completed:** ${p.isComplete} after ${p.iterationCount} iterations.\n\n` +
            `Distill the episode now.`,
        );

        const resp = await p.distillerModel.invoke([DISTILLER_SYSTEM, input]);
        const content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
        if (content.trim() === 'SKIP') {
            logger.info({ tenantId: p.tenantId, userId: p.userId, threadId: p.threadId }, 'Episode distiller skipped — routine run');
            return false;
        }
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) {
            logger.warn({ tenantId: p.tenantId, userId: p.userId, threadId: p.threadId }, 'Episode distiller output had no JSON object — not saved');
            return false;
        }
        const parsed = JSON.parse(match[0]) as Partial<EpisodicValue>;
        if (!isNonEmptyString(parsed.context) || !isNonEmptyString(parsed.reasoning)
            || !isNonEmptyString(parsed.action) || !isNonEmptyString(parsed.outcome)) {
            logger.warn({ tenantId: p.tenantId, userId: p.userId, threadId: p.threadId }, 'Episode distiller output invalid — not saved');
            return false;
        }
        const value: EpisodicValue = {
            context: parsed.context, reasoning: parsed.reasoning,
            action: parsed.action, outcome: parsed.outcome,
        };
        await getMemoryService().remember({
            tenantId: p.tenantId, userId: p.userId, kind: 'EPISODIC',
            namespace: ['episodes'], key: `thread-${p.threadId}`,
            value: value as unknown as Record<string, unknown>,
            sourceThreadId: p.threadId,
        });
        logger.info({ tenantId: p.tenantId, userId: p.userId, threadId: p.threadId }, 'Captured episode for thread');
        return true;
    } catch (err: any) {
        logger.warn({ tenantId: p.tenantId, userId: p.userId, threadId: p.threadId, error: err?.message ?? err }, 'Episode capture failed (non-fatal)');
        return false;
    }
}

/** Render episodes as few-shot experience blocks; '' for empty input. */
export function formatEpisodesSection(episodes: EpisodicValue[]): string {
    if (!episodes.length) return '';
    const blocks = episodes.map((e) =>
        `**Situation:** ${e.context}\n**Approach:** ${e.reasoning}\n**Actions taken:** ${e.action}\n**Outcome:** ${e.outcome}`,
    ).join('\n\n---\n\n');
    return `### Past experience (similar previous sessions)\n${blocks}`;
}

/**
 * Compose memoryContext from facts + episodes + learned rules. Facts-only returns
 * the bare facts string (byte-identical to pre-Phase-3 behavior); the "Known facts"
 * header appears only when facts coexist with another section. Output order:
 * facts → operating rules → past experience (imperatives before illustrations).
 */
export function composeMemoryContext(factsSection: string, episodesSection: string, proceduresSection = ''): string {
    const facts = factsSection.trim();
    const episodes = episodesSection.trim();
    const procedures = proceduresSection.trim();
    const others = [procedures, episodes].filter(Boolean);
    if (facts && others.length) return [`### Known facts\n${facts}`, ...others].join('\n\n');
    if (facts) return facts;
    return others.join('\n\n');
}
