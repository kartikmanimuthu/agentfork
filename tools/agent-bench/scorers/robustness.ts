/**
 * robustness.ts — does the same question behave the same way twice?
 *
 * This is the dimension a single-shot comparison cannot see at all, and it
 * matters here more than usual: `temperature` could not be pinned (Sonnet 5
 * rejects it), so both arms run at model default and every question is sampled
 * afresh on each repetition.
 *
 * "Flaky" means the completion verdict CHANGED across repetitions — the agent
 * did the task sometimes and not others. That is worse than consistent failure,
 * because consistent failure is at least predictable and diagnosable.
 */

import type { CompletionScore } from './completion';

export interface RobustnessScore {
  questionId: string;
  arm: string;
  repetitions: number;
  passRate: number;
  flaky: boolean;
  latencyMedianMs: number;
  latencySpreadRatio: number;
}

export function scoreRobustness(
  completions: CompletionScore[],
  latenciesMs: number[],
): Omit<RobustnessScore, 'questionId' | 'arm'> {
  const passes = completions.filter((c) => c.passed).length;
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  return {
    repetitions: completions.length,
    passRate: completions.length ? passes / completions.length : 0,
    // Neither always-pass nor always-fail: the outcome depends on the sample.
    flaky: passes > 0 && passes < completions.length,
    latencyMedianMs: median,
    latencySpreadRatio: min > 0 ? max / min : 0,
  };
}
