import type { BaseMessage } from '@langchain/core/messages';

export type MemoryKind = 'SEMANTIC' | 'EPISODIC' | 'PROCEDURAL';

export interface SemanticValue { fact: string; source: string; confidence: 'high' | 'medium'; }
export interface EpisodicValue { context: string; reasoning: string; action: string; outcome: string; }
export interface ProceduralValue { instruction: string; trigger: string; evidence: string; confidence?: 'high' | 'medium'; }

export interface MemoryHit {
    id: string;
    namespace: string;
    key: string;
    value: Record<string, unknown>;
    kind: MemoryKind;
    /** Cosine distance to the query (0 = identical); present only on vector-search hits. */
    distance?: number;
}

export interface Scratchpad {
    openGoals: string[];
    keyFindings: string[];
    resourceIds: string[];
    pendingSteps: string[];
}

export interface WorkingMemory {
    runningSummary: string;
    scratchpad: Scratchpad;
    tokenCount: number;
    turnCount: number;
}

export interface ExtractedFact {
    /** Memory layer this item belongs to; absent = 'SEMANTIC'. */
    kind?: MemoryKind;
    namespace: string[];
    key: string;
    value: SemanticValue | ProceduralValue;
}

export type ReconcileAction = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'REINFORCE' | 'NOOP';

export interface ReconcileDecision {
    factIndex: number;
    action: ReconcileAction;
    targetId?: string;                     // UPDATE / SUPERSEDE / REINFORCE
    mergedValue?: Record<string, unknown>; // UPDATE only
}

export interface ReconcileSummary {
    added: number;
    updated: number;
    superseded: number;
    reinforced: number;
    noop: number;
    failed: number;
}

/**
 * Minimal structural state the shared memory nodes need. Both the chat agents'
 * ReflectionState (agent-shared.ts) and Agent Ops' ReflectionState
 * (agent-ops/executor-state.ts, once it carries memoryContext) satisfy this.
 */
export interface MemoryNodeState {
    messages: BaseMessage[];
    taskDescription: string;
    plan: Array<{ step: string; status: string }>;
    toolResults: Array<{ toolName: string; output: string; isError: boolean; iterationIndex: number }>;
    errors: string[];
    reflection: string;
    iterationCount: number;
    isComplete: boolean;
    memoryContext: string;
    memoryStats?: MemoryStats | null;
}

export interface MemoryHitStat { key: string; distance?: number }
export interface MemoryRecallStats {
    phase: 'recall';
    facts: MemoryHitStat[];      // raw semantic hits (pre-LLM-filter)
    rules: MemoryHitStat[];      // distance-gate survivors
    episodes: MemoryHitStat[];   // distance-gate survivors
    injected: boolean;           // memoryContext non-empty
}
export interface MemorySaveStats {
    phase: 'save';
    savedFacts: number;          // SEMANTIC items extracted+persisted
    savedRules: number;          // PROCEDURAL items extracted+persisted
    episodeCaptured: boolean;
    reconcileActions?: Record<string, number>;  // {added,updated,superseded,reinforced,noop,failed}
}
export type MemoryStats = MemoryRecallStats | MemorySaveStats;
