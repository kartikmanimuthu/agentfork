import type { BaseMessage } from '@langchain/core/messages';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getRecentMessages } from '../agent/agent-shared';
import type { ReflectionState } from '../agent/agent-shared';
import type { Scratchpad, WorkingMemory } from './types';
import { getMemoryService } from './memory-service';

// Working-memory configuration. Read process.env directly (not the typed `env`
// object) so Vitest can mutate values per-test — env.ts skips validation under
// NODE_ENV==='test' but caches at import time.
export function workingMemoryEnabled(): boolean {
    const v = process.env.WORKING_MEMORY_ENABLED?.toLowerCase();
    return !(v === 'false' || v === '0');
}

// Legacy default when neither an env override nor a model-derived budget is available.
const DEFAULT_TOKEN_BUDGET = 60000;

// Explicit operator override via env, or null when unset/invalid. When set it wins over
// any model-derived budget passed by the caller — a deliberate kill-switch / escape hatch.
export function tokenBudgetOverride(): number | null {
    const raw = process.env.WORKING_MEMORY_TOKEN_BUDGET;
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export function tokenBudget(): number {
    return tokenBudgetOverride() ?? DEFAULT_TOKEN_BUDGET;
}

export function keepRecent(): number {
    const n = Number(process.env.WORKING_MEMORY_KEEP_RECENT);
    return Number.isFinite(n) && n > 0 ? n : 8;
}

export function emptyScratchpad(): Scratchpad {
    return { openGoals: [], keyFindings: [], resourceIds: [], pendingSteps: [] };
}

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function messageText(m: BaseMessage): string {
    return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

export function estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
}

export function compressToolOutput(content: string, maxChars = 2000): string {
    if (content.length <= maxChars) return content;
    const half = Math.floor(maxChars / 2);
    const head = content.slice(0, half);
    const tail = content.slice(content.length - half);
    return `${head}\n… [${content.length - maxChars} chars elided] …\n${tail}`;
}

// Pick the most-recent messages that fit `budget` tokens, always keeping at least
// `keep` of them, then run getRecentMessages() to preserve tool_call/tool_result
// pairing and drop empties (Bedrock adjacency rules).
export function selectWindow(messages: BaseMessage[], budget: number, keep: number): BaseMessage[] {
    if (messages.length === 0) return [];
    let count = Math.min(keep, messages.length);
    let used = estimateMessagesTokens(messages.slice(messages.length - count));
    for (let i = messages.length - count - 1; i >= 0; i--) {
        const t = estimateTokens(messageText(messages[i]));
        if (used + t > budget) break;
        used += t;
        count++;
    }
    const slice = messages.slice(messages.length - count);
    return getRecentMessages(slice, slice.length);
}

export function buildWorkingMemorySection(wm: WorkingMemory | null): string {
    if (!wm) return '';
    const s = wm.scratchpad ?? emptyScratchpad();
    const list = (label: string, items: string[]) =>
        items && items.length ? `\n**${label}:**\n${items.map((i) => `- ${i}`).join('\n')}` : '';
    const body = [
        wm.runningSummary ? `\n${wm.runningSummary}` : '',
        list('Open goals', s.openGoals),
        list('Key findings', s.keyFindings),
        list('Resource IDs', s.resourceIds),
        list('Pending steps', s.pendingSteps),
    ].join('');
    if (!body.trim()) return '';
    return `\n## Working Memory\nA compacted record of this long-running session so far:${body}\n`;
}

function uniq(a: string[]): string[] { return Array.from(new Set(a.filter(Boolean))); }

function mergeScratchpad(prev: Scratchpad, next: Partial<Scratchpad>): Scratchpad {
    return {
        openGoals: uniq([...(prev.openGoals ?? []), ...(next.openGoals ?? [])]),
        keyFindings: uniq([...(prev.keyFindings ?? []), ...(next.keyFindings ?? [])]),
        resourceIds: uniq([...(prev.resourceIds ?? []), ...(next.resourceIds ?? [])]),
        pendingSteps: uniq([...(prev.pendingSteps ?? []), ...(next.pendingSteps ?? [])]),
    };
}

// Fold evicted turns into the running summary + scratchpad using the reflector
// model. Monotonicity (never lose a recorded goal/finding) is enforced in code by
// MERGING the LLM output with the prior scratchpad — we do not trust the LLM to
// carry everything forward.
export async function foldWorkingMemory(
    prev: WorkingMemory,
    evicted: BaseMessage[],
    reflectorModel: BaseChatModel,
): Promise<WorkingMemory> {
    const transcript = evicted
        .map((m) => `[${m._getType()}] ${compressToolOutput(messageText(m), 1200)}`)
        .join('\n\n');

    const sys = new SystemMessage(
        `You compress a long-running agent session into durable working memory. ` +
        `Given the prior summary/scratchpad and newly-evicted turns, return ONLY a JSON object:\n` +
        `{"summary": string, "scratchpad": {"openGoals": string[], "keyFindings": string[], "resourceIds": string[], "pendingSteps": string[]}}\n` +
        `- summary: a concise cumulative narrative (fold the new turns into the prior summary).\n` +
        `- scratchpad: only NEW items discovered in the evicted turns (prior items are preserved automatically).\n` +
        `Never fabricate. Return the JSON object and nothing else.`,
    );
    const input = new HumanMessage(
        `**Prior summary:**\n${prev.runningSummary || '(none)'}\n\n` +
        `**Prior open goals:** ${JSON.stringify(prev.scratchpad?.openGoals ?? [])}\n\n` +
        `**Newly evicted turns:**\n${compressToolOutput(transcript, 8000)}`,
    );

    let summary = prev.runningSummary;
    let newSp: Partial<Scratchpad> = {};
    try {
        const resp = await reflectorModel.invoke([sys, input]);
        const content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
            const parsed = JSON.parse(match[0]) as { summary?: string; scratchpad?: Partial<Scratchpad> };
            if (parsed.summary) summary = parsed.summary;
            if (parsed.scratchpad) newSp = parsed.scratchpad;
        }
    } catch {
        // Folding failure is non-fatal — keep the prior summary, still advance turnCount.
    }

    return {
        runningSummary: summary,
        scratchpad: mergeScratchpad(prev.scratchpad ?? emptyScratchpad(), newSp),
        tokenCount: 0,
        turnCount: (prev.turnCount ?? 0) + 1,
    };
}

export interface PrepareContextDeps {
    reflectorModel: BaseChatModel;
    tenantId?: string;
    threadId?: string;
    /** Model-derived input-token budget (provider context window minus reserved output
     *  tokens). Used when no explicit WORKING_MEMORY_TOKEN_BUDGET env override is set, so
     *  small/local models (8k–32k) aren't over-budgeted by the legacy 60k default. */
    budgetTokens?: number;
    /** Rough token cost of the always-on system prompt, subtracted from the budget so the
     *  window accounting reflects the real per-call input, not just message tokens. */
    systemPromptTokens?: number;
}
export interface PreparedContext {
    windowMessages: BaseMessage[];
    workingMemorySection: string;
    stateUpdate: Partial<Pick<ReflectionState, 'runningSummary' | 'scratchpad'>>;
}

export async function prepareContext(
    state: ReflectionState,
    deps: PrepareContextDeps,
    fallbackWindow: number,
): Promise<PreparedContext> {
    const { messages } = state;

    // Disabled → identical to legacy behavior.
    if (!workingMemoryEnabled()) {
        return {
            windowMessages: getRecentMessages(messages, fallbackWindow),
            workingMemorySection: '',
            stateUpdate: {},
        };
    }

    // Budget resolution: explicit env override wins; otherwise the caller's model-derived
    // budget; otherwise the legacy default. The always-on system prompt is charged against
    // the budget so the message window accounts for the real per-call input, not just
    // message tokens (a small/local model's context is spent on the system prompt too).
    const inputCapacity = tokenBudgetOverride() ?? deps.budgetTokens ?? DEFAULT_TOKEN_BUDGET;
    const budget = Math.max(1, inputCapacity - (deps.systemPromptTokens ?? 0));
    const keep = keepRecent();
    const total = estimateMessagesTokens(messages);

    const currentWm: WorkingMemory = {
        runningSummary: state.runningSummary ?? '',
        scratchpad: state.scratchpad ?? emptyScratchpad(),
        tokenCount: total,
        turnCount: 0,
    };

    // Under budget → no compaction; surface any existing WM from state.
    if (total <= budget) {
        const hasWm = currentWm.runningSummary || (currentWm.scratchpad.openGoals?.length ?? 0) > 0;
        return {
            windowMessages: selectWindow(messages, budget, keep),
            workingMemorySection: hasWm ? buildWorkingMemorySection(currentWm) : '',
            stateUpdate: {},
        };
    }

    // Over budget → fold the evicted prefix into working memory.
    const window = selectWindow(messages, budget, keep);
    const evicted = messages.slice(0, Math.max(0, messages.length - window.length));
    const folded = evicted.length
        ? await foldWorkingMemory(currentWm, evicted, deps.reflectorModel)
        : currentWm;

    // Durable mirror (best-effort; checkpoint state is the source of truth).
    if (deps.tenantId && deps.threadId) {
        getMemoryService()
            .putWorkingMemory({ tenantId: deps.tenantId, threadId: deps.threadId, wm: folded })
            .catch(() => {});
    }

    return {
        windowMessages: window,
        workingMemorySection: buildWorkingMemorySection(folded),
        stateUpdate: { runningSummary: folded.runningSummary, scratchpad: folded.scratchpad },
    };
}
