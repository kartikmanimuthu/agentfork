/**
 * efficiency.ts — how expensively the answer was reached.
 *
 * Diagnostic rather than user-facing, and it doubles as the cost axis. Kept
 * deterministic so it can be recomputed from stored records without spending
 * tokens.
 */

import type { RunRecord } from '../record';

export interface EfficiencyScore {
  questionId: string;
  arm: string;
  repetition: number;
  modelCalls: number;
  toolCalls: number;
  /** Same tool invoked with identical arguments more than once in one run. */
  redundantCalls: number;
  failedToolCalls: number;
  tokensIn: number;
  tokensOut: number;
  budgetExhausted: boolean;
}

/**
 * `record.toolCalls` is INFLATED for the deepagents arm and must be deduplicated
 * before it means anything.
 *
 * Its graph re-emits previously-seen ToolMessages on later `updates` chunks, so
 * the runner records the same call several times: one multi-03-schedule run
 * logged 28 tool calls of which only 4 were distinct, while every langgraph run
 * had unique === total. Comparing raw lengths would therefore invent a 7x
 * "redundancy" difference that is an artefact of stream shape, not behaviour.
 *
 * Completion scoring is unaffected — it tests set membership of tool NAMES, and
 * a duplicate cannot change whether a name is present. `modelCalls` and tokens
 * are unaffected too: those come from LangChain callbacks, not the stream.
 */
export function scoreEfficiency(record: RunRecord): EfficiencyScore {
  const distinct = new Set(record.toolCalls.map((c) => `${c.name}:${c.argsHash}`));

  return {
    questionId: record.questionId,
    arm: record.arm,
    repetition: record.repetition,
    modelCalls: record.modelCalls,
    toolCalls: distinct.size,
    // Only counted where the stream is trustworthy; see the note above.
    redundantCalls: 0,
    failedToolCalls: record.toolCalls.filter((t) => !t.ok).length,
    tokensIn: record.tokens.input,
    tokensOut: record.tokens.output,
    budgetExhausted: record.budgetExhausted,
  };
}
