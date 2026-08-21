/**
 * agent-shared.ts — minimal bridge for the memory cognitive layers + executor graph.
 *
 * Nucleus's `agent-shared.ts` is a 30KB+ file coupling AWS/DevOps-specific agent
 * plumbing (model config resolution, tool wiring, checkpointer wiring) with a few
 * generic pieces the memory layer and executor graph need. Only the generic pieces
 * are ported here: `getRecentMessages`, `truncateOutput`, `extractTextContent`,
 * `computeReflectionStall`/`REFLECTION_STALL_LIMIT` (all verbatim, AWS-free) and the
 * `ReflectionState`/`PlanStep`/`ToolResultEntry` shapes `working-memory.ts` and
 * `executor-state.ts` type against.
 */

import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Scratchpad, MemoryStats } from '../memory/types';

export interface PlanStep {
    step: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ToolResultEntry {
    toolName: string;
    output: string;
    isError: boolean;
    iterationIndex: number;
}

export interface ReflectionState {
    messages: BaseMessage[];
    taskDescription: string;
    plan: PlanStep[];
    code: string;
    executionOutput: string;
    errors: string[];
    reflection: string;
    iterationCount: number;
    nextAction: string;
    isComplete: boolean;
    toolResults: ToolResultEntry[];
    memoryContext: string;
    memoryStats: MemoryStats | null;
    runningSummary: string;
    scratchpad: Scratchpad;
    reflectionStallCount?: number;
}

// Get recent messages safely - ensuring tool call/result pairs are kept together
// Also filters out empty messages that cause Bedrock API errors
export function getRecentMessages(messages: BaseMessage[], maxMessages: number = 30): BaseMessage[] {
    // First, filter out messages with empty content (but keep AIMessages with tool_calls)
    const validMessages = messages.filter(msg => {
        const content = msg.content;
        // AIMessages with tool_calls are valid even with empty content
        if (msg._getType() === 'ai' && 'tool_calls' in msg) {
            const aiMsg = msg as AIMessage;
            if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) return true;
        }
        // Filter out empty content
        if (!content) return false;
        if (typeof content === 'string' && content.trim() === '') return false;
        if (Array.isArray(content) && content.length === 0) return false;
        return true;
    });

    if (validMessages.length === 0) return [];

    let result: BaseMessage[] = [];
    const firstMsg = validMessages[0];

    // Build a proper subset that maintains tool_call/tool_result pairing
    // Strategy: Start from the end and work backwards, always including complete tool call groups
    let i = validMessages.length - 1;

    // If fewer messages than max, just take them all
    if (validMessages.length <= maxMessages) {
        result = [...validMessages];
    } else {
        // Collect from tail
        while (i >= 0 && result.length < maxMessages * 2) {
            const msg = validMessages[i];

            if (msg._getType() === 'tool') {
                // Found a ToolMessage - we need to find ALL tool messages in this batch
                const toolBatch: BaseMessage[] = [msg];
                let j = i - 1;

                while (j >= 0 && validMessages[j]._getType() === 'tool') {
                    toolBatch.unshift(validMessages[j]);
                    j--;
                }

                if (j >= 0 && validMessages[j]._getType() === 'ai') {
                    const aiMsg = validMessages[j] as AIMessage;
                    if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
                        result.unshift(...toolBatch);
                        result.unshift(validMessages[j]);
                        i = j - 1;
                    } else { i = j; }
                } else { i = j; }
            } else {
                result.unshift(msg);
                i--;
            }
        }
    }

    // Trim from the FRONT to enforce maxMessages, always stripping full tool-pair groups to avoid orphans.
    // We must not split an AI-with-tool-calls and its following ToolMessages.
    while (result.length > maxMessages) {
        // Remove the first element
        result.shift();
        // If the new front is a ToolMessage, keep removing until we reach a non-tool message
        // (we stripped the AI message that owned these tool results, so they'd be orphaned)
        while (result.length > 0 && result[0]._getType() === 'tool') {
            result.shift();
        }
    }

    // 1. Ensure conversation starts with the first User message (Task)
    if (result.length > 0 && result[0] !== firstMsg) {
        // Remove orphans if any
        while (result.length > 0 && result[0]._getType() === 'tool') {
            result.shift();
        }
        // Prepend first message
        if (result.length === 0 || result[0] !== firstMsg) {
            result.unshift(firstMsg);
        }
    } else if (result.length === 0) {
        result.push(firstMsg);
    }

    // 2. Formatting for Bedrock/Nova: Ensure strictly alternating Human/AI roles
    // We iterate and insert "Proceed" messages if we see AI -> AI
    const formattedResult: BaseMessage[] = [];
    if (result.length > 0) formattedResult.push(result[0]); // Push first (User)

    for (let k = 1; k < result.length; k++) {
        const prev = formattedResult[formattedResult.length - 1];
        const curr = result[k];

        // Fix: AI -> AI (Insert Human)
        if (prev._getType() === 'ai' && curr._getType() === 'ai') {
            formattedResult.push(new HumanMessage({ content: "Proceed." }));
        }

        // Fix: User -> User (Insert AI ack)
        if (prev._getType() === 'human' && curr._getType() === 'human') {
            formattedResult.push(new AIMessage({ content: "Acknowledged." }));
        }

        formattedResult.push(curr);
    }

    // Final sanity check: Must start with Human (which firstMsg is)
    // But if firstMsg was somehow AI (should not happen if validMessages[0] is User), we fix.
    if (formattedResult.length > 0 && formattedResult[0]._getType() === 'ai') {
        formattedResult.unshift(new HumanMessage({ content: "Start session." }));
    }

    return formattedResult;
}

/**
 * Removes orphaned tool-call/tool-result pairs from a message list before it is
 * sent to the model. Providers (OpenAI, Bedrock, …) reject a history where an
 * assistant message with `tool_calls` isn't followed by a ToolMessage for every
 * id, or where a ToolMessage has no matching preceding call. Interrupted/aborted
 * runs, or a truncated recent-message window, can leave such orphans in the
 * checkpointed thread — this strips them so the next model call is always valid.
 * (Ported role: nucleus' `sanitizeMessagesForBedrock`, generalized to any provider.)
 */
export function sanitizeToolCallPairs(messages: BaseMessage[]): BaseMessage[] {
    const answeredIds = new Set<string>();
    for (const m of messages) {
        if (m._getType() === 'tool') {
            const id = (m as { tool_call_id?: string }).tool_call_id;
            if (id) answeredIds.add(id);
        }
    }

    const keptCallIds = new Set<string>();
    const out: BaseMessage[] = [];
    for (const m of messages) {
        if (m._getType() === 'ai') {
            const aiMsg = m as AIMessage;
            const toolCalls = aiMsg.tool_calls ?? [];
            if (toolCalls.length > 0) {
                const allAnswered = toolCalls.every((tc) => tc.id && answeredIds.has(tc.id));
                if (!allAnswered) {
                    // Orphaned tool call(s): keep only the assistant's text (if any),
                    // dropping the tool_calls so the pairing invariant holds.
                    const text = extractTextContent(aiMsg.content);
                    if (text.trim()) out.push(new AIMessage({ content: text }));
                    continue;
                }
                for (const tc of toolCalls) if (tc.id) keptCallIds.add(tc.id);
            }
            out.push(m);
            continue;
        }
        if (m._getType() === 'tool') {
            const id = (m as { tool_call_id?: string }).tool_call_id;
            if (!id || !keptCallIds.has(id)) continue; // orphaned tool response
            out.push(m);
            continue;
        }
        out.push(m);
    }
    return out;
}

export function truncateOutput(text: string, maxChars: number = 500): string {
    if (!text) return "";
    if (text.length > maxChars) {
        return text.slice(0, maxChars) + "...";
    }
    return text;
}

/**
 * Consecutive-unproductive-reflection threshold — ported verbatim from
 * nucleus (REFLECTION_STALL_LIMIT). Past this many consecutive reflections
 * reporting the SAME blocking issue, the run bails to `final` rather than
 * churning to the iteration cap. Nucleus's own comment cites a real incident
 * this hardening prevents: a run burned 1.4M tokens repeating a single
 * tool-arg error before a human cancelled it.
 */
export const REFLECTION_STALL_LIMIT = 2;

/**
 * Normalizes a reflector's free-text `issues` string for repeat comparison.
 *
 * Nucleus compared with raw `===`, which made stall detection effectively
 * dead: the reflector rewrites this prose every round, and its input changes
 * each round too (latest draft + recent tool results), so two consecutive
 * byte-identical strings essentially never occurred. Case/whitespace/trailing
 * punctuation are noise here — the same complaint reworded is still the same
 * complaint, and that is exactly what the stall check exists to catch.
 */
function normalizeIssues(issues: string): string {
    return issues.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!;,]+$/, '');
}

/**
 * Ported from nucleus lib/agent/agent-shared.ts, with the comparison relaxed
 * from exact equality to normalized equality (see `normalizeIssues`).
 * `currentIssues` counts as a stall repeat only when it's non-empty/non-'None'
 * AND matches the previous reflection's issues.
 *
 * `sameCoreIssueAsBefore` extends this beyond text matching: normalized-text
 * equality only catches the reflector repeating itself near-verbatim, which
 * free-text LLM prose rarely does even when it's genuinely stuck on the same
 * root cause reworded each round. The caller (`reflectNode`) asks the SAME
 * model call that produced `currentIssues` to also judge, in one shot, whether
 * it describes the same underlying problem as `prevIssues` — no extra model
 * call, since it rides along in the existing reflection JSON. This flag is
 * ignored unless there's an actual previous issue to compare against, so a
 * caller passing `true` with no real prior issue can't manufacture a stall.
 */
export function computeReflectionStall(
    currentIssues: string,
    prevIssues: string | undefined,
    prevStallCount: number,
    sameCoreIssueAsBefore = false,
): { stallCount: number; stalled: boolean } {
    const hasIssue = !!currentIssues && normalizeIssues(currentIssues) !== 'none';
    const hasPrevIssue = !!prevIssues && normalizeIssues(prevIssues) !== 'none';
    const textRepeated = hasIssue && !!prevIssues
        && normalizeIssues(prevIssues) === normalizeIssues(currentIssues);
    const repeated = hasIssue && hasPrevIssue && (textRepeated || sameCoreIssueAsBefore);
    const stallCount = repeated ? prevStallCount + 1 : 0;
    return { stallCount, stalled: stallCount >= REFLECTION_STALL_LIMIT };
}

/**
 * Consumes a chat model's `.stream()` output, emitting only genuine
 * incremental text via `onDelta`, and returns the fully aggregated chunk.
 *
 * Why this exists: a previous attempt at UI streaming subscribed to
 * LangGraph's `messages` stream mode, which taps chunks as the model produces
 * them and assumes they are pure deltas (each chunk is NEW text, safe to
 * concatenate). In production, the same reply came out doubled in the
 * PERSISTED graph state — not a rendering bug, the stored AIMessage content
 * itself was `answer + answer`. The likely cause: not every provider's
 * streamed chunks are delta-style: some emit the cumulative text-so-far in
 * each chunk, and blind concatenation of two cumulative chunks doubles the
 * overlap. `messages` mode also taps EVERY node's model call indiscriminately
 * (evaluator's raw JSON included), so filtering by node name was the only
 * guard against leaking internal output — a second thing to get wrong.
 *
 * This is deliberately independent of that mechanism. It owns the accumulator
 * and checks, per chunk, whether the new piece already contains everything
 * accumulated so far (`piece.startsWith(textSoFar)`): if so the chunk is
 * cumulative and only the new suffix is a real delta; otherwise the chunk is
 * itself the delta. Correct either way, and correct if a provider changes
 * which style it uses.
 *
 * IMPORTANT: `aggregated.content` is NOT safe to read as the answer.
 * `AIMessageChunk.concat()` is used to merge `tool_calls`/id/metadata across
 * chunks, but it assumes delta-style content and string-concatenates it — fed
 * cumulative chunks, THIS is what corrupts state (verified below: it
 * reproduces the same repeated-prefix garbage as the doubling bug this
 * replaced). Callers must use the returned `text` field — the
 * hand-deduplicated accumulator — never `aggregated.content`.
 */
export async function streamWithDeltas(
    stream: AsyncIterable<AIMessageChunk>,
    onDelta: (delta: string) => void,
): Promise<{ aggregated: AIMessageChunk; text: string }> {
    let aggregated: AIMessageChunk | undefined;
    let textSoFar = '';

    for await (const chunk of stream) {
        aggregated = aggregated ? aggregated.concat(chunk) : chunk;

        const piece = extractTextContent(chunk.content);
        if (!piece) continue;

        if (piece.startsWith(textSoFar)) {
            const delta = piece.slice(textSoFar.length);
            if (delta) onDelta(delta);
            textSoFar = piece;
        } else {
            onDelta(piece);
            textSoFar += piece;
        }
    }

    if (!aggregated) throw new Error('Model stream produced no chunks');
    return { aggregated, text: textSoFar };
}

export function extractTextContent(content: unknown): string {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((block: any) => {
                if (typeof block === 'string') return block;
                if (block?.type === 'text' && typeof block.text === 'string') return block.text;
                return '';
            })
            .join('');
    }
    return typeof content === 'object' ? JSON.stringify(content) : String(content);
}
