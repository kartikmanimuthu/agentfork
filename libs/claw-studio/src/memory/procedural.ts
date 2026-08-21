/**
 * procedural.ts — procedural memory (Phase 4): learned operating rules.
 *
 * Capture rides the memory-save extraction (kind: 'PROCEDURAL' items) and the
 * kind-aware reconcile pipeline. This module holds the flag, recall constants,
 * the prompt-section formatter, and the shape-aware extraction-item validator.
 */

import type { ProceduralValue } from './types';

export const PROCEDURE_RECALL_LIMIT = 3;
// Shared value with EPISODE_DISTANCE_THRESHOLD — one knob until logs say otherwise.
export const PROCEDURE_DISTANCE_THRESHOLD = 0.65;

export function proceduralMemoryEnabled(): boolean {
    const v = process.env.PROCEDURAL_MEMORY_ENABLED?.toLowerCase();
    return !(v === 'false' || v === '0');
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

/** Render learned rules as an imperative prompt section; '' for empty input. */
export function formatProceduresSection(rules: ProceduralValue[]): string {
    if (!rules.length) return '';
    const lines = rules.map((r) => `- When ${r.trigger}: ${r.instruction}`);
    return `### Operating rules (learned)\n${lines.join('\n')}`;
}

/**
 * Shape-aware validity check for raw extracted items (semantic or procedural).
 * Both shapes require high/medium confidence; procedural items additionally
 * require instruction/trigger/evidence, semantic items require fact.
 */
export function isValidExtractedItem(item: { kind?: string; value?: Record<string, unknown> }): boolean {
    const v = item?.value;
    if (!v || typeof v !== 'object') return false;
    if (v.confidence !== 'high' && v.confidence !== 'medium') return false;
    if (item.kind === 'PROCEDURAL') {
        return isNonEmptyString(v.instruction) && isNonEmptyString(v.trigger) && isNonEmptyString(v.evidence);
    }
    return isNonEmptyString(v.fact);
}
