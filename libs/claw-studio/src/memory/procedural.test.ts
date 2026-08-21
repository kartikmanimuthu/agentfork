import { describe, it, expect, afterEach } from 'vitest';
import {
    proceduralMemoryEnabled, formatProceduresSection, isValidExtractedItem,
    PROCEDURE_RECALL_LIMIT, PROCEDURE_DISTANCE_THRESHOLD,
} from './procedural';

afterEach(() => { delete process.env.PROCEDURAL_MEMORY_ENABLED; });

describe('proceduralMemoryEnabled', () => {
    it('defaults true; false/0 disable', () => {
        expect(proceduralMemoryEnabled()).toBe(true);
        process.env.PROCEDURAL_MEMORY_ENABLED = 'false';
        expect(proceduralMemoryEnabled()).toBe(false);
    });
});

describe('constants', () => {
    it('locked values', () => {
        expect(PROCEDURE_RECALL_LIMIT).toBe(3);
        expect(PROCEDURE_DISTANCE_THRESHOLD).toBe(0.65);
    });
});

describe('formatProceduresSection', () => {
    it("returns '' for empty input", () => {
        expect(formatProceduresSection([])).toBe('');
    });
    it('renders one "- When <trigger>: <instruction>" line per rule under the header', () => {
        const s = formatProceduresSection([
            { instruction: 'Always paginate list calls', trigger: 'any AWS CLI list operation', evidence: 'e1' },
            { instruction: 'Verify state before mutation', trigger: 'any resource mutation', evidence: 'e2' },
        ]);
        expect(s).toBe(
            '### Operating rules (learned)\n' +
            '- When any AWS CLI list operation: Always paginate list calls\n' +
            '- When any resource mutation: Verify state before mutation',
        );
    });
});

describe('isValidExtractedItem', () => {
    const semantic = (v: Record<string, unknown>) => ({ value: v });
    const procedural = (v: Record<string, unknown>) => ({ kind: 'PROCEDURAL', value: v });

    it('semantic: requires non-empty fact + high/medium confidence', () => {
        expect(isValidExtractedItem(semantic({ fact: 'x', confidence: 'high' }))).toBe(true);
        expect(isValidExtractedItem(semantic({ fact: 'x', confidence: 'low' }))).toBe(false);
        expect(isValidExtractedItem(semantic({ fact: '  ', confidence: 'high' }))).toBe(false);
        expect(isValidExtractedItem(semantic({ confidence: 'high' }))).toBe(false);
    });

    it('procedural: requires non-empty instruction/trigger/evidence + high/medium confidence', () => {
        expect(isValidExtractedItem(procedural({ instruction: 'i', trigger: 't', evidence: 'e', confidence: 'medium' }))).toBe(true);
        expect(isValidExtractedItem(procedural({ instruction: 'i', trigger: 't', confidence: 'high' }))).toBe(false);
        expect(isValidExtractedItem(procedural({ instruction: 'i', trigger: 't', evidence: '', confidence: 'high' }))).toBe(false);
        expect(isValidExtractedItem(procedural({ instruction: 'i', trigger: 't', evidence: 'e', confidence: 'low' }))).toBe(false);
    });

    it('rejects missing/non-object value', () => {
        expect(isValidExtractedItem({} as any)).toBe(false);
        expect(isValidExtractedItem({ value: undefined } as any)).toBe(false);
    });
});
