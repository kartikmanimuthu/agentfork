/**
 * record.ts — the schema for one benchmark run.
 *
 * One record per (question, repetition, arm). Deliberately flat and
 * self-describing: the scorers and the report read these files without needing
 * the harness, and a results directory stays interpretable months later.
 *
 * See docs/superpowers/specs/2026-08-10-agent-loop-comparison-design.md §4.
 */

import { z } from 'zod';

export const ARMS = ['langgraph', 'deepagents'] as const;
export type Arm = (typeof ARMS)[number];

export const toolCallSchema = z.object({
  name: z.string(),
  /** Stable hash of the arguments — lets the efficiency scorer spot a repeated identical call without storing payloads. */
  argsHash: z.string(),
  ok: z.boolean(),
  ms: z.number().nonnegative(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const runRecordSchema = z.object({
  arm: z.enum(ARMS),
  questionId: z.string(),
  repetition: z.number().int().nonnegative(),
  startedAt: z.string(),

  latency: z.object({
    totalMs: z.number().nonnegative(),
    /**
     * Time to the first stream chunk carrying assistant text. Graph-level, NOT
     * per-token: `libs/claw-studio/CLAUDE.md` records that token streaming via
     * the `custom` stream mode is currently dead, so a UI-level figure would
     * measure that bug rather than the agent.
     */
    timeToFirstTextMs: z.number().nonnegative().nullable(),
  }),

  /**
   * Counted uniformly for both arms by reading `graph.getState()` after the run
   * and counting AIMessages — NOT from either arm's own counter, since Arm A's
   * executor-state iteration count and Arm B's modelCallLimitMiddleware
   * runModelCallCount count different events.
   */
  modelCalls: z.number().int().nonnegative(),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),

  toolCalls: z.array(toolCallSchema),
  /**
   * Tools the agent was OFFERED. Neither arm exposes its bound tool list through
   * a public accessor, so this is left empty by the runner and the ~14-tool
   * surface difference (spec §3.1) is enumerated statically in the report
   * instead. Kept in the schema so a future runner that can capture it does not
   * change the record format.
   */
  toolsOffered: z.array(z.string()).default([]),

  finalText: z.string(),
  interrupts: z.number().int().nonnegative(),
  /** True when the run ended on modelCallLimitMiddleware rather than finishing. */
  budgetExhausted: z.boolean(),
  error: z.string().nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/** Written once per arm per session, so a results dir records the conditions it was produced under. */
export const runManifestSchema = z.object({
  arm: z.enum(ARMS),
  startedAt: z.string(),
  gitRef: z.string(),
  gitDirty: z.boolean(),
  treePath: z.string(),
  controls: z.object({
    maxIterations: z.number().int().positive(),
    temperature: z.number(),
    promptSurface: z.string(),
    autoApprove: z.boolean(),
    model: z.string(),
    repetitions: z.number().int().positive(),
  }),
  /** The composed system prompt, for the §6.1 cross-arm diff. */
  systemPrompt: z.string(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export function parseRecords(jsonl: string): RunRecord[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      const parsed = runRecordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`Malformed run record on line ${i + 1}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}
