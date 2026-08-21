import { describe, it, expect } from 'vitest';
import { buildMemoryMarkdown, buildAllMemoriesMarkdown, buildMemoryFile } from './memory-export';

const semantic = {
  id: 'm-1', namespace: 'billing', key: 'invoice-format', kind: 'SEMANTIC' as const,
  value: { fact: 'Invoices use net-30 terms', source: 'user', confidence: 'high' },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  expiresAt: '2026-04-01T00:00:00.000Z', supersededById: null,
};

const procedural = {
  id: 'm-2', namespace: 'ops', key: 'paginate-lists', kind: 'PROCEDURAL' as const,
  value: { instruction: 'Always paginate list calls', trigger: 'any list operation', evidence: 'missed a resource once' },
  createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z',
  expiresAt: '2026-04-03T00:00:00.000Z', supersededById: null,
};

const episodic = {
  id: 'm-3', namespace: 'ops', key: 'run-2026-01-04', kind: 'EPISODIC' as const,
  value: { context: 'Investigated a billing spike', reasoning: 'Checked recent invoices', action: 'Queried invoice table', outcome: 'Found a duplicate charge' },
  createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z',
  expiresAt: '2026-04-04T00:00:00.000Z', supersededById: null,
};

describe('buildMemoryMarkdown', () => {
  it('includes the metadata table and kind-specific fields for SEMANTIC', () => {
    const md = buildMemoryMarkdown(semantic);
    expect(md).toContain('# invoice-format');
    expect(md).toContain('| Kind | SEMANTIC |');
    expect(md).toContain('**Fact:** Invoices use net-30 terms');
    expect(md).toContain('**Confidence:** high');
  });

  it('renders PROCEDURAL fields', () => {
    const md = buildMemoryMarkdown(procedural);
    expect(md).toContain('**Instruction:** Always paginate list calls');
    expect(md).toContain('**Trigger:** any list operation');
  });

  it('renders EPISODIC fields with no confidence line', () => {
    const md = buildMemoryMarkdown(episodic);
    expect(md).toContain('**Outcome:** Found a duplicate charge');
    expect(md).not.toContain('Confidence');
  });
});

describe('buildAllMemoriesMarkdown', () => {
  it('reports no memories to export for an empty list', () => {
    expect(buildAllMemoriesMarkdown([])).toContain('_No memories to export._');
  });

  it('groups by kind in SEMANTIC, EPISODIC, PROCEDURAL order', () => {
    const md = buildAllMemoriesMarkdown([procedural, semantic, episodic]);
    expect(md.indexOf('### SEMANTIC')).toBeLessThan(md.indexOf('### EPISODIC'));
    expect(md.indexOf('### EPISODIC')).toBeLessThan(md.indexOf('### PROCEDURAL'));
  });
});

describe('buildMemoryFile', () => {
  it('produces YAML frontmatter followed by the value body', () => {
    const file = buildMemoryFile(semantic);
    expect(file).toMatch(/^---\nkind: SEMANTIC/);
    expect(file).toContain('key: "invoice-format"');
    expect(file).toContain('**Fact:** Invoices use net-30 terms');
  });
});
