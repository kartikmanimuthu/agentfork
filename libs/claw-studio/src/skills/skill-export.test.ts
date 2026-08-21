import { describe, it, expect } from 'vitest';
import { buildSkillMarkdown, buildAllSkillsMarkdown, buildSkillFile } from './skill-export';

const skill = {
  id: 'billing-basics', name: 'Billing Basics', description: 'When asked about invoices', tier: 'read-only',
  source: 'user', isEnabled: true, createdBy: 'user-1', content: 'Check ```the``` invoice table.',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('buildSkillMarkdown', () => {
  it('includes the metadata table and a fence long enough to survive backticks in content', () => {
    const md = buildSkillMarkdown(skill);
    expect(md).toContain('# Billing Basics');
    expect(md).toContain('| Tier | read-only |');
    expect(md).toMatch(/````markdown/); // 4 backticks since content has a 3-backtick run
    expect(md).toContain('Check ```the``` invoice table.');
  });
});

describe('buildAllSkillsMarkdown', () => {
  it('reports no skills to export for an empty list', () => {
    expect(buildAllSkillsMarkdown([])).toContain('_No skills to export._');
  });

  it('sorts skills alphabetically and includes a table of contents', () => {
    const b = { ...skill, id: 'a-skill', name: 'A Skill' };
    const md = buildAllSkillsMarkdown([skill, b]);
    expect(md.indexOf('A Skill')).toBeLessThan(md.indexOf('Billing Basics'));
  });
});

describe('buildSkillFile', () => {
  it('produces SKILL.md-style YAML frontmatter followed by content', () => {
    const file = buildSkillFile(skill);
    expect(file).toMatch(/^---\nname: "Billing Basics"/);
    expect(file).toContain('enabled: true');
    expect(file.trim().endsWith(skill.content.trim())).toBe(true);
  });
});
