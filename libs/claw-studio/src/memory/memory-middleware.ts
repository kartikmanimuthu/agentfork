/**
 * memory-middleware.ts — carries Claw's pgvector memory across to the
 * deepagents loop. deepagents' own `createMemoryMiddleware` loads prompt files;
 * it has no embeddings or vector recall, so it is not a substitute.
 *
 * Recall runs once per agent invocation and injects context; save runs after
 * the turn. Both wrap the existing node factories (`createMemoryRecallNode` /
 * `createMemorySaveNode` in `./memory-nodes.ts`) unchanged, so the reconcile
 * judge, episodic capture and skill synthesis all keep firing from the save
 * path.
 *
 * Memory failure is non-fatal, matching the graph: a failed embedding degrades
 * to recency text search rather than aborting the run. Every hook below is
 * wrapped in try/catch and never rethrows — a pgvector outage or a malformed
 * extraction response must not abort the turn.
 *
 * Hook names verified against the real `AgentMiddleware` interface in
 * `node_modules/langchain/dist/agents/middleware/types.d.ts` (re-exported from
 * the top-level `langchain` package, which is also where deepagents' own
 * `agent-*.d.ts` imports `AgentMiddleware` from).
 *
 * Fix round 2, Critical 1 + Important 3 — two bugs the construction-only
 * tests from round 1 could not have caught:
 *
 * 1. `beforeModel` → `beforeAgent` for recall. `beforeModel` fires before
 *    EVERY model request in a multi-iteration turn (tool call → model call →
 *    tool call → model call ...); `beforeAgent` fires exactly once per
 *    `invoke()`, matching the old graph's single `memory_recall` node and
 *    keeping the embedding + 3 pgvector queries + LLM relevance filter
 *    (`memory-nodes.ts`'s `memoryRecallNode`) off the hot path for every
 *    iteration after the first.
 * 2. Added `wrapModelCall`. The recall hook only ever wrote `memoryContext`
 *    into STATE — nothing in deepagents/langchain reads `state.memoryContext`
 *    on its own and splices it into the outgoing prompt (that was
 *    `claw-graph.ts`'s job, via `getDynamicContext()`'s `memorySection`, done
 *    fresh in every node). Without a hook that actively appends it to the
 *    request the model receives, recall was pure cost with the result
 *    silently discarded — the success log still printed, nothing was wrong
 *    detectably at runtime. `wrapModelCall` appends the SAME wrapper text
 *    `getDynamicContext()` used at `claw-graph.ts:213`, verbatim, including
 *    its "trust your actual tools over this" caveat, so a recalled memory
 *    reads identically to a user regardless of which execution path produced
 *    the answer. The state write is KEPT — `memorySaveNode`
 *    (`memory-nodes.ts:237,293`) still reads `state.memoryContext` back as the
 *    already-known/do-not-re-save list.
 *
 * A THIRD bug surfaced writing the integration test for #2, not covered by
 * the coordinator's finding text, and load-bearing enough to fix here rather
 * than defer: every hook below needs its own `stateSchema`.
 * `node_modules/langchain/dist/agents/nodes/utils.cjs`'s `derivePrivateState`
 * is what each middleware HOOK NODE declares as its LangGraph node `input`
 * schema — `derivePrivateState(undefined)` (i.e. no `stateSchema` on this
 * middleware) resolves to `z.object({ messages, structuredResponse })` ONLY.
 * LangGraph then hands the node just those channels — regardless of what the
 * COMPOSITION ROOT's top-level `stateSchema` declares. Proven empirically:
 * without the `stateSchema` below, `wrapModelCall`'s `request.state.memoryContext`
 * read back `undefined` even though `beforeAgent` had just written it and the
 * FINAL invoke() result correctly showed it (round 1's test only checked the
 * final result, which passes regardless of this bug — it never exercised a
 * hook reading a value a sibling hook on the SAME middleware had written).
 * Same mechanism would have made `afterAgent`'s `saveNode` call blind to
 * `state.taskDescription`/`state.memoryContext` too. Declaring `stateSchema`
 * here (in addition to, not instead of, `claw-deep-agent.ts`'s top-level
 * `clawMemoryStateSchema`, which still matters for agents with no memory
 * middleware attached and for the extra ReAct-loop fields nothing else
 * declares) is what makes every hook here actually see these fields.
 */
import { z } from 'zod';
import { SystemMessage } from '@langchain/core/messages';
import { createLogger } from '@chatbot/shared';
import type { AgentMiddleware } from 'langchain';
import type { MemoryNodeState, MemoryRecallStats, MemorySaveStats } from './types';

// `memoryStats` is declared here for the same `derivePrivateState` reason the
// other two fields are (see the module doc): without it on THIS middleware's
// schema, a value returned by `beforeAgent`/`afterAgent` is not a channel these
// hooks can write, so the stats never reach the graph chunk that
// `deriveNodeEvents` reads — which is exactly why recall and save were doing
// real work that never appeared on the chat timeline. Typed loosely (`unknown`)
// rather than as the real `MemoryStats` union because the value is only ever
// passed through to the event deriver, never read back here, and a zod mirror
// of that union would have to be kept in sync by hand.
const memoryMiddlewareStateSchema = z.object({
    memoryContext: z.string().default(''),
    taskDescription: z.string().default(''),
    memoryStats: z.unknown().optional(),
});

const logger = createLogger('claw-studio:memory-middleware');

/**
 * Matches `createMemoryRecallNode(deps)`'s returned function signature
 * (`./memory-nodes.ts`) exactly. `deps` there is module-private, so the node
 * factory itself is not imported here — callers build it and hand in the
 * resulting closure.
 */
type RecallNode = (
    state: MemoryNodeState,
) => Promise<{ memoryContext: string; memoryStats: MemoryRecallStats | null }>;

/**
 * Matches `createMemorySaveNode(deps)`'s returned function signature. The
 * second argument is the LangGraph runtime config (`runtimeConfig?.configurable?.thread_id`
 * is read internally for episodic capture and skill synthesis) — whatever the
 * middleware's `runtime` argument is, it must be passed through unchanged.
 */
type SaveNode = (
    state: MemoryNodeState,
    runtimeConfig?: unknown,
) => Promise<{ memoryStats: MemorySaveStats | null }>;

export interface ClawMemoryDeps {
    recallNode: RecallNode;
    saveNode: SaveNode;
}

/**
 * Reused VERBATIM from `getDynamicContext()`'s `memorySection` at
 * `claw-graph.ts:213` — including the "trust your actual tools over this"
 * caveat — so recalled memory reads identically to a user whether it arrived
 * via the old graph or this middleware.
 */
function memorySection(memoryContext: string): string {
    return `\n## Background from earlier sessions (optional)\n${memoryContext}\n_This is background only and may be outdated — especially any claim about which tools or integrations are or aren't connected. For that, trust only the tools actually available to you in this message, never a memory note about it. Use this background ONLY if it directly helps with the user's current message. The current conversation and any active skill always take priority — if this background isn't clearly relevant, ignore it completely and do not mention it._\n`;
}

// `AgentMiddleware`'s bare (ungenericised) type defaults every type param to
// `any`, which resolves each hook's expected state-update type to a bare
// `Partial<{}>` with an index signature of `undefined` — a concrete key
// (`memoryContext`/`taskDescription`: string) then fails to typecheck even
// though `stateSchema: memoryMiddlewareStateSchema` is set below. Binding the
// return type to the schema here is what makes TS infer `beforeAgent` /
// `wrapModelCall`'s hook types from that schema instead of the `any` default
// — a compile-time fix only; LangGraph resolves state channels by key name at
// runtime regardless of this annotation.
export function createClawMemoryMiddleware(deps: ClawMemoryDeps): AgentMiddleware<typeof memoryMiddlewareStateSchema> {
    return {
        name: 'clawMemory',
        stateSchema: memoryMiddlewareStateSchema,

        // Once per invocation (not per model call) — see module doc, Important 3.
        async beforeAgent(state: unknown, _runtime: unknown) {
            try {
                const { memoryContext, memoryStats } = await deps.recallNode(state as MemoryNodeState);
                // `memoryStats` is returned even when the recall found nothing and
                // `memoryContext` is empty. An empty recall is still activity the
                // user asked to see — "searched memory, found nothing relevant" is
                // information, and silently returning undefined here is what made
                // memory look like it was never running at all.
                if (!memoryContext) return memoryStats ? { memoryStats } : undefined;
                return { memoryContext, ...(memoryStats ? { memoryStats } : {}) };
            } catch (err) {
                logger.warn({ err }, '[memory] recall failed — continuing without context');
                return undefined;
            }
        },

        // Splices the recalled context into every model call this turn makes —
        // see module doc, Critical 1. Without this, `state.memoryContext` is
        // written but never read by anything, and recall's cost buys nothing.
        // Left unannotated (unlike every other hook here) so the request/handler
        // parameter types are inferred contextually from `WrapModelCallHook<typeof
        // memoryMiddlewareStateSchema, ...>` via the function's return type above —
        // that's what gives `request.state.memoryContext` a real `string` type and
        // lets `handler({ ...request, systemMessage: ... })` typecheck against the
        // handler's full `ModelRequest` shape, matching the library's own
        // `wrapModelCall` doc example verbatim (`node_modules/langchain/dist/agents/nodes/types.d.ts`).
        // An explicit `unknown` annotation here (as used elsewhere in this file for
        // defensive narrowing) breaks that inference and reintroduces TS2322.
        async wrapModelCall(request, handler) {
            try {
                const { memoryContext } = request.state;
                if (!memoryContext) return handler(request);
                return handler({
                    ...request,
                    systemMessage: request.systemMessage.concat(new SystemMessage(memorySection(memoryContext))),
                });
            } catch (err) {
                logger.warn({ err }, '[memory] failed to append recalled context to the model request — continuing without it');
                return handler(request);
            }
        },

        async afterAgent(state: unknown, runtime: unknown) {
            try {
                // `runtime` is passed through unchanged — memory-nodes.ts reads
                // `runtimeConfig?.configurable?.thread_id` off it for episodic
                // capture and skill synthesis.
                //
                // The return value used to be discarded outright, so what the save
                // path extracted, reconciled and captured was invisible to the
                // timeline even though `memory-nodes.ts` had already computed it.
                const { memoryStats } = await deps.saveNode(state as MemoryNodeState, runtime);
                return memoryStats ? { memoryStats } : undefined;
            } catch (err) {
                logger.warn({ err }, '[memory] save failed — run already answered');
                return undefined;
            }
        },
    };
}
