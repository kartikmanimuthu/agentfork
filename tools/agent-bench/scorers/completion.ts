/**
 * completion.ts — deterministic scoring. No judge, no model call.
 *
 * A run completes when it called every tool the question expects and none it
 * forbids. `expectedTools` is a rubric, not ground truth (spec §7): a run that
 * reaches a correct answer by another route scores as incomplete here, which is
 * why `report.ts` prints the actual tool sequence next to every failure so the
 * rubric can be argued with rather than trusted.
 *
 * `forbiddenTools` carries most of the value. The ambiguous and refusal
 * questions are ones where acting confidently IS the failure — "Update the file
 * with the new details" should produce a question, not a write — and a scorer
 * that only rewarded helpfulness would score that backwards.
 */

import { CORPUS_BY_ID } from '../questions/corpus';
import type { RunRecord } from '../record';

export interface CompletionScore {
  questionId: string;
  arm: string;
  repetition: number;
  passed: boolean;
  missingTools: string[];
  forbiddenUsed: string[];
  /** True when the run produced no answer text at all. */
  empty: boolean;
  reason: string;
}

export function scoreCompletion(record: RunRecord): CompletionScore {
  const question = CORPUS_BY_ID.get(record.questionId);
  if (!question) throw new Error(`Unknown questionId in results: ${record.questionId}`);

  const used = new Set(record.toolCalls.map((t) => t.name));
  const missingTools = question.expectedTools.filter((t) => !used.has(t));
  const forbiddenUsed = (question.forbiddenTools ?? []).filter((t) => used.has(t));
  const empty = record.finalText.trim().length === 0;

  const reasons: string[] = [];
  if (record.error) reasons.push(`errored: ${record.error}`);
  if (empty) reasons.push('no answer text');
  if (missingTools.length) reasons.push(`missing ${missingTools.join(',')}`);
  if (forbiddenUsed.length) reasons.push(`used forbidden ${forbiddenUsed.join(',')}`);

  return {
    questionId: record.questionId,
    arm: record.arm,
    repetition: record.repetition,
    passed: reasons.length === 0,
    missingTools,
    forbiddenUsed,
    empty,
    reason: reasons.join('; ') || 'ok',
  };
}
