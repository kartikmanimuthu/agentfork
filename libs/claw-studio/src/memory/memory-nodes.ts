/**
 * memory-nodes.ts
 *
 * Shared memory_recall and memory_save graph nodes for the Claw.
 * memory_recall: semantic search + LLM relevance filter before task execution.
 * memory_save: LLM extraction of learnings after task completion.
 *
 * Ported from nucleus lib/agent/memory-nodes.ts — logic verbatim; console.* swapped
 * for the shared Pino logger (repo mandatory standard, and the same swap Task 2-4's
 * cognitive layers already made). `synthesizeDomainSkills` (Plan C4) is imported
 * directly — no longer a local stub.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger } from '@chatbot/shared';
import { truncateOutput, extractTextContent } from '../agent/agent-shared';
import { saveMemory } from '../agent/persistence';
import { getMemoryService } from './memory-service';
import { memoryLogVerbose } from './log';
import {
    captureEpisode, episodicMemoryEnabled, formatEpisodesSection, composeMemoryContext,
    EPISODE_RECALL_LIMIT, EPISODE_DISTANCE_THRESHOLD,
} from './episode';
import { reconcileMemories, reconcileEnabled } from './reconcile';
import { buildLiveCapabilityIndex, filterSuppressiveRules, type LiveCapabilities } from './live-capability-gate';
import {
    proceduralMemoryEnabled, formatProceduresSection, isValidExtractedItem,
    PROCEDURE_RECALL_LIMIT, PROCEDURE_DISTANCE_THRESHOLD,
} from './procedural';
import { synthesizeDomainSkills } from '../skills/skill-synthesis';
import type {
    ExtractedFact, EpisodicValue, ProceduralValue, MemoryNodeState,
    MemoryRecallStats, MemorySaveStats, MemoryHitStat,
} from './types';

const logger = createLogger('claw-studio:memory-nodes');

/** Extraction prompts ask for a bare JSON array, but models occasionally fence it anyway. */
function stripCodeFences(text: string): string {
    return text.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
}

interface MemoryNodeDeps {
    reflectorModel: BaseChatModel;
    tenantId?: string;
    userId?: string;
    store: unknown | null;
    /**
     * What the model can actually reach on this turn — bound tool names and
     * reachable MCP servers. Used ONLY to withhold learned rules that would
     * argue against a live tool (see `live-capability-gate.ts` for the failure
     * that motivated it). Optional: a caller that does not supply it gets
     * today's behaviour, every recalled rule injected.
     */
    liveCapabilities?: LiveCapabilities;
}

/** Hard cap on how long memory recall may take before the turn proceeds without it. */
const MEMORY_RECALL_TIMEOUT_MS = 20_000;

/**
 * The facts relevance filter below calls `reflectorModel` — the SAME chat
 * model used for the main conversation turn (see claw-graph.ts's
 * `reflectorModel ?? model` fallback) — with no timeout of its own. A single
 * slow/cold Bedrock response here can consume nearly the entire
 * MEMORY_RECALL_TIMEOUT_MS budget by itself, starving the cheap rules/episodes
 * lookups that run after it, and — since the outer race below only gives up
 * on the *caller's* wait rather than cancelling this in-flight call — leaves
 * it running in the background afterward, competing for the same Bedrock
 * quota as the turn's later evaluator/planner/generate steps. Bounding it
 * here keeps the whole recall well inside its 20s budget in the common case.
 */
const FACTS_FILTER_TIMEOUT_MS = 8_000;

export function createMemoryRecallNode(deps: MemoryNodeDeps) {
    const { reflectorModel, tenantId, userId, store, liveCapabilities } = deps;
    const liveIndex = buildLiveCapabilityIndex(liveCapabilities ?? { toolNames: [], servers: [] });

    return async function memoryRecallNode(state: MemoryNodeState): Promise<{ memoryContext: string; memoryStats: MemoryRecallStats | null }> {
        if (!store || !tenantId || !userId) {
            logger.info({ tenantId, userId, hasStore: !!store }, '[MemoryRecall] Skipped — store, tenantId, or userId not available');
            return { memoryContext: '', memoryStats: null };
        }

        // Recall does embedding + vector queries + an LLM relevance filter; any of
        // those stalling (e.g. a hung embeddings request) would otherwise freeze
        // the whole turn, since recall runs before every other node. Cap it and
        // degrade to "no memory" on timeout so the chat always makes progress.
        const runRecall = async (): Promise<{ memoryContext: string; memoryStats: MemoryRecallStats | null }> => {
        const { messages } = state;
        const lastHuman = [...messages].reverse().find(m => m._getType() === 'human');
        if (!lastHuman) {
            logger.info({ tenantId, userId }, '[MemoryRecall] Skipped — no human message found');
            return { memoryContext: '', memoryStats: null };
        }

        const query = typeof lastHuman.content === 'string'
            ? lastHuman.content
            : JSON.stringify(lastHuman.content);

        logger.info({ tenantId, userId, query: truncateOutput(query, 100) }, '[MemoryRecall] Searching memories');

        const factStats: MemoryHitStat[] = [];
        const ruleStats: MemoryHitStat[] = [];
        const episodeStats: MemoryHitStat[] = [];

        // ── Semantic facts → existing LLM relevance filter ──────────────────
        let factsSection = '';
        try {
            const hits = await getMemoryService().recall({
                tenantId, userId, query, kinds: ['SEMANTIC'], limit: 10,
            });
            logger.info(
                { tenantId, userId, hits: hits.map(h => ({ key: h.key, distance: h.distance })) },
                '[MemoryRecall:facts] hits',
            );
            hits.forEach(h => factStats.push({ key: h.key, distance: h.distance }));
            if (hits.length > 0) {
                const memorySummary = hits.map((m, i) =>
                    `${i + 1}. [${m.namespace}/${m.key}] ${JSON.stringify(m.value)}`
                ).join('\n');
                try {
                    const filterPrompt = new SystemMessage(
                        `You are a relevance filter. Given a user task and a list of memories from previous sessions, return ONLY the memories that are directly relevant to the current task.

Return a markdown list of relevant memories, each on its own line with the format:
- [namespace/key] One-line summary of the relevant fact

If no memories are relevant, return exactly: NONE`
                    );
                    const filterInput = new HumanMessage({
                        content: `**User Task:** ${truncateOutput(query, 2000)}

**Available Memories:**
${memorySummary}

Return only the relevant memories.`
                    });
                    const response = await reflectorModel.invoke([filterPrompt, filterInput], {
                        signal: AbortSignal.timeout(FACTS_FILTER_TIMEOUT_MS),
                    });
                    const content = extractTextContent(response.content);
                    factsSection = (content.trim() === 'NONE') ? '' : content.trim();
                    logger.info({ tenantId, userId, kept: !!factsSection }, '[MemoryRecall:facts] LLM filter applied');
                } catch (err: any) {
                    logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemoryRecall] Relevance filter failed');
                    factsSection = hits.slice(0, 5).map(m =>
                        `- [${m.namespace}/${m.key}] ${JSON.stringify(m.value)}`
                    ).join('\n');
                }
            }
        } catch (err: any) {
            logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemoryRecall] Semantic search failed');
        }

        // ── Learned operating rules — distance-gated, no LLM filter ─────────
        let proceduresSection = '';
        if (proceduralMemoryEnabled()) {
            try {
                const rules = await getMemoryService().recall({
                    tenantId, userId, query, kinds: ['PROCEDURAL'], limit: PROCEDURE_RECALL_LIMIT,
                });
                const nearRules = rules.filter(r => r.distance !== undefined && r.distance <= PROCEDURE_DISTANCE_THRESHOLD);
                logger.info(
                    { tenantId, userId, rules: rules.map(r => ({ key: r.key, distance: r.distance, kept: r.distance !== undefined && r.distance <= PROCEDURE_DISTANCE_THRESHOLD })) },
                    '[MemoryRecall:rules] distance gate',
                );
                nearRules.forEach(r => ruleStats.push({ key: r.key, distance: r.distance }));
                const near = nearRules
                    .map(r => r.value as unknown as ProceduralValue)
                    .filter(v => !!v?.instruction && !!v?.trigger);
                // A rule learned when a capability was missing must not outlive
                // the outage and talk the model out of using it now that it is
                // back. Distance ranked these as relevant precisely BECAUSE they
                // are about the tool the user is asking for.
                const { kept: usableRules } = filterSuppressiveRules(near, liveIndex);
                if (usableRules.length > 0) {
                    proceduresSection = formatProceduresSection(usableRules);
                }
            } catch (err: any) {
                logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemoryRecall] Procedural search failed');
            }
        }

        // ── Episodic few-shot replay — distance-gated, no LLM filter ────────
        let episodesSection = '';
        if (episodicMemoryEnabled()) {
            try {
                const eps = await getMemoryService().recall({
                    tenantId, userId, query, kinds: ['EPISODIC'], limit: EPISODE_RECALL_LIMIT,
                });
                const near = eps.filter(e => e.distance !== undefined && e.distance <= EPISODE_DISTANCE_THRESHOLD);
                logger.info(
                    { tenantId, userId, episodes: eps.map(e => ({ key: e.key, distance: e.distance, kept: e.distance !== undefined && e.distance <= EPISODE_DISTANCE_THRESHOLD })) },
                    '[MemoryRecall:episodes] distance gate',
                );
                near.forEach(e => episodeStats.push({ key: e.key, distance: e.distance }));
                if (near.length > 0) {
                    episodesSection = formatEpisodesSection(near.map(e => e.value as unknown as EpisodicValue));
                }
            } catch (err: any) {
                logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemoryRecall] Episodic search failed');
            }
        }

        const memoryContext = composeMemoryContext(factsSection, episodesSection, proceduresSection);
        if (memoryContext) {
            logger.info(
                { tenantId, userId, facts: !!factsSection, rules: !!proceduresSection, episodes: !!episodesSection, chars: memoryContext.length },
                '[MemoryRecall] memoryContext assembled',
            );
            if (memoryLogVerbose()) {
                logger.debug({ tenantId, userId, memoryContext }, '[MemoryRecall] Injected into system prompt');
            }
        } else {
            logger.info({ tenantId, userId }, '[MemoryRecall] Nothing relevant found');
        }
        return {
            memoryContext,
            memoryStats: {
                phase: 'recall',
                facts: factStats, rules: ruleStats, episodes: episodeStats,
                injected: memoryContext.length > 0,
            },
        };
        };

        try {
            return await Promise.race([
                runRecall(),
                new Promise<{ memoryContext: string; memoryStats: MemoryRecallStats | null }>((_, reject) =>
                    setTimeout(() => reject(new Error(`memory recall exceeded ${MEMORY_RECALL_TIMEOUT_MS}ms`)), MEMORY_RECALL_TIMEOUT_MS),
                ),
            ]);
        } catch (err: any) {
            logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemoryRecall] Timed out or failed — proceeding without memory');
            return { memoryContext: '', memoryStats: null };
        }
    };
}

export function createMemorySaveNode(deps: MemoryNodeDeps) {
    const { reflectorModel, tenantId, userId, store } = deps;

    return async function memorySaveNode(state: MemoryNodeState, runtimeConfig?: any): Promise<{ memoryStats: MemorySaveStats | null }> {
        if (!store || !tenantId || !userId) {
            logger.info({ tenantId, userId, hasStore: !!store }, '[MemorySave] Skipped — store, tenantId, or userId not available');
            return { memoryStats: null };
        }

        const { messages, taskDescription, memoryContext } = state;
        if (messages.length < 2) {
            logger.info({ tenantId, userId }, '[MemorySave] Skipped — conversation too short to extract learnings');
            return { memoryStats: null };
        }

        logger.info({ tenantId, userId }, '[MemorySave] Analyzing session for learnings');

        let savedFacts = 0;
        let savedRules = 0;
        let reconcileActions: Record<string, number> | undefined;

        const recentMessages = messages.slice(-20);
        const conversationSummary = recentMessages.map(m => {
            const role = m._getType();
            const content = typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content);
            return `[${role}] ${truncateOutput(content, 500)}`;
        }).join('\n\n');

        const extractPrompt = new SystemMessage(
            `You are a memory extraction engine. Analyze the completed agent session and extract facts worth remembering for future sessions.

**Categories and namespace conventions:**
- Infrastructure facts → namespace: ["infra", "<account-id-or-general>"]
  Examples: cluster regions, instance types, service configurations, resource counts
- User preferences → namespace: ["user", "preferences"]
  Examples: preferred output format, naming conventions, default regions, workflow preferences
- Task outcomes / solutions → namespace: ["patterns", "<service-type>"]
  Examples: how a scaling issue was resolved, successful deployment patterns
- Error resolutions → namespace: ["errors", "<service-type>"]
  Examples: how an OOM was fixed, what caused a timeout, permission error workarounds
` + (proceduralMemoryEnabled() ? `- Operating rules → add "kind": "PROCEDURAL", namespace: ["procedures", "<domain>"]
  A rule for HOW the agent should behave in this environment, learned from this run.
  Extract a rule ONLY from a correction, a failure the run recovered from, or an explicit user preference about behavior.
  Shape: { "kind": "PROCEDURAL", "namespace": ["procedures", "aws-cli"], "key": "paginate-list-calls", "value": { "instruction": "Always paginate list/describe calls", "trigger": "any AWS CLI list operation", "evidence": "run truncated results and missed the target resource", "confidence": "high" } }
` : '') + `
**Rules:**
- Only extract facts that would be useful in a FUTURE session — skip ephemeral details
- Each memory must have confidence "high" or "medium" — skip anything uncertain
- Use descriptive, unique keys (e.g., "prod-ecs-cluster-region" not "fact-1")
- Do NOT re-save facts that already exist in the known memories below

**Return format:** A JSON array of objects:
` + '```' + `json
[{ "namespace": ["infra", "123456789"], "key": "prod-cluster-region", "value": { "fact": "Production ECS cluster runs in us-east-1", "source": "discovered via describe-clusters", "confidence": "high" } }]
` + '```' + `

Return an empty array ` + '`[]`' + ` if nothing new is worth saving.`
        );

        const extractInput = new HumanMessage({
            content: `**Original Task:** ${truncateOutput(taskDescription || 'Unknown', 500)}

**Already Known (do NOT re-save):**
${memoryContext || 'No existing memories.'}

**Session Transcript (recent):**
${truncateOutput(conversationSummary, 8000)}

Extract memories to save.`
        });

        try {
            const response = await reflectorModel.invoke([extractPrompt, extractInput]);
            let content = stripCodeFences(extractTextContent(response.content));

            let jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                logger.info({ tenantId, userId }, '[MemorySave] No JSON array found in response — nothing to save');
                return { memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false } };
            }

            let memories: Array<{
                kind?: string;
                namespace: string[];
                key: string;
                value: Record<string, unknown>;
            }>;
            try {
                memories = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                // One repair attempt: model output is occasionally not-quite-JSON (a stray
                // trailing comma, truncation, surrounding prose). Feed the exact parse
                // error back and ask for a corrected array before giving up — a second
                // failure here falls through to the outer catch below, same as before.
                logger.warn(
                    { tenantId, userId, error: (parseError as Error).message },
                    '[MemorySave] Extraction JSON malformed — retrying once with the parse error',
                );
                const repairInput = new HumanMessage(
                    `Your previous response was not valid JSON:\n\n${jsonMatch[0]}\n\nParse error: ${(parseError as Error).message}\n\nReturn ONLY the corrected JSON array, nothing else.`,
                );
                const repairResponse = await reflectorModel.invoke([extractPrompt, extractInput, response, repairInput]);
                content = stripCodeFences(extractTextContent(repairResponse.content));
                jsonMatch = content.match(/\[[\s\S]*\]/);
                if (!jsonMatch) {
                    logger.info({ tenantId, userId }, '[MemorySave] No JSON array found after repair retry — nothing to save');
                    return { memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false } };
                }
                memories = JSON.parse(jsonMatch[0]);
            }

            const toSave = memories.filter(isValidExtractedItem);
            savedFacts = toSave.filter(m => m.kind !== 'PROCEDURAL').length;
            savedRules = toSave.filter(m => m.kind === 'PROCEDURAL').length;
            logger.info(
                {
                    tenantId, userId,
                    extracted: toSave.map(m => ({ key: m.key, kind: m.kind === 'PROCEDURAL' ? 'PROCEDURAL' : 'SEMANTIC' })),
                    dropped: memories.length - toSave.length,
                },
                '[MemorySave] Extraction result',
            );

            if (toSave.length === 0) {
                logger.info({ tenantId, userId }, '[MemorySave] No high/medium confidence memories to save');
                return { memoryStats: { phase: 'save', savedFacts: 0, savedRules: 0, episodeCaptured: false } };
            }

            if (reconcileEnabled()) {
                logger.info({ tenantId, userId, count: toSave.length }, '[MemorySave] Reconciling extracted facts');
                const threadId = runtimeConfig?.configurable?.thread_id as string | undefined;
                const summary = await reconcileMemories({
                    tenantId, userId,
                    facts: toSave.map(m => ({
                        kind: m.kind === 'PROCEDURAL' ? 'PROCEDURAL' as const : undefined,
                        namespace: m.namespace, key: m.key, value: m.value,
                    })) as unknown as ExtractedFact[],
                    judgeModel: reflectorModel,
                    sourceThreadId: threadId,
                });
                logger.info({ tenantId, userId, summary }, '[MemorySave] Reconcile complete');
                reconcileActions = {
                    added: summary.added, updated: summary.updated, superseded: summary.superseded,
                    reinforced: summary.reinforced, noop: summary.noop, failed: summary.failed,
                };
            } else {
                logger.info({ tenantId, userId, count: toSave.length }, '[MemorySave] Saving memories (reconcile disabled)');
                for (const mem of toSave) {
                    try {
                        if (mem.kind === 'PROCEDURAL') {
                            // Persist with the PROCEDURAL kind (saveMemory hardcodes SEMANTIC),
                            // matching how the reconcile-on path stores rules. Without this,
                            // procedural memory silently never works unless reconcile is also on,
                            // even though recall/extraction/skill-synthesis all still run.
                            await getMemoryService().remember({
                                tenantId, userId, kind: 'PROCEDURAL',
                                namespace: mem.namespace, key: mem.key,
                                value: mem.value as Record<string, unknown>,
                            });
                        } else {
                            await saveMemory(tenantId, userId, mem.namespace, mem.key, mem.value as Record<string, unknown>);
                        }
                        logger.info(
                            { tenantId, userId, namespace: mem.namespace.join('/'), key: mem.key, procedural: mem.kind === 'PROCEDURAL' },
                            '[MemorySave] Saved',
                        );
                    } catch (err: any) {
                        logger.warn({ tenantId, userId, key: mem.key, error: err?.message ?? err }, '[MemorySave] Failed to save');
                    }
                }
            }
        } catch (err: any) {
            logger.warn({ tenantId, userId, error: err?.message ?? err }, '[MemorySave] Extraction failed');
        }

        // ── Episodic capture — independent of fact extraction; never blocks END ──
        // Defaulted, NOT destructured bare. These channels are declared on
        // createClawDeepAgent's top-level stateSchema, but LangGraph scopes a
        // middleware hook's INPUT state to that middleware's own stateSchema
        // (derivePrivateState) — and memoryMiddlewareStateSchema declares only
        // memoryContext and taskDescription. So every field here arrives as
        // `undefined` rather than its declared default, and `toolResults.length`
        // threw `Cannot read properties of undefined (reading 'length')`,
        // killing the whole save. It only surfaced where episodic memory is
        // enabled, because && short-circuits before the property access.
        //
        // Nothing writes these channels under deepagents anyway (the graph
        // nodes that did were deleted), so they are effectively always empty —
        // but they must not be able to throw.
        const {
            plan = [],
            toolResults = [],
            errors = [],
            reflection = '',
            isComplete = false,
            iterationCount = 0,
        } = (state ?? {}) as Partial<MemoryNodeState>;
        const threadIdForEpisode = runtimeConfig?.configurable?.thread_id as string | undefined;
        const shouldCapture = episodicMemoryEnabled() && !!threadIdForEpisode && toolResults.length > 0;
        if (shouldCapture) {
            await captureEpisode({
                tenantId, userId, threadId: threadIdForEpisode,
                distillerModel: reflectorModel,
                taskDescription, plan, toolResults, errors, reflection, isComplete, iterationCount,
            });
        }

        // Autonomous skill synthesis — matured domains become/refresh enabled system skills.
        if (proceduralMemoryEnabled() && tenantId && userId) {
            await synthesizeDomainSkills({ tenantId, userId, threadId: threadIdForEpisode, distillerModel: reflectorModel });
        }

        return {
            memoryStats: {
                phase: 'save', savedFacts, savedRules,
                episodeCaptured: shouldCapture, reconcileActions,
            },
        };
    };
}
