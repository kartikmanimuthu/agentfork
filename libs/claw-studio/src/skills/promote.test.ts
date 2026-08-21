import { describe, it, expect } from 'vitest';
import { buildSkillDraftFromMemory } from './promote';

describe('buildSkillDraftFromMemory', () => {
  it('returns null for a non-PROCEDURAL row', () => {
    expect(buildSkillDraftFromMemory({ kind: 'SEMANTIC', key: 'x', value: {} })).toBeNull();
  });

  it('returns null when instruction/trigger are missing', () => {
    expect(buildSkillDraftFromMemory({ kind: 'PROCEDURAL', key: 'x', value: { instruction: 'do it' } })).toBeNull();
  });

  it('builds a read-only draft from a valid procedural row, humanizing the key as the name', () => {
    const draft = buildSkillDraftFromMemory({
      kind: 'PROCEDURAL', key: 'paginate-list-calls',
      value: { instruction: 'Always paginate list calls', trigger: 'any list operation', evidence: 'missed a resource once' },
    });
    expect(draft).toEqual({
      name: 'Paginate List Calls',
      description: 'any list operation',
      tier: 'read-only',
      content: expect.stringContaining('Always paginate list calls'),
    });
    expect(draft!.content).toContain('missed a resource once');
  });
});
