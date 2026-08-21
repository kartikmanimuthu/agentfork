import { describe, expect, it } from 'vitest';
import { composeIdentity } from './prompt-composer';
import type { WorkspaceSlug } from '../workspace/types';

const files = (entries: Partial<Record<WorkspaceSlug, string>>) =>
  new Map(Object.entries(entries) as Array<[WorkspaceSlug, string]>);

describe('composeIdentity', () => {
  it('returns an empty string when there are no files', () => {
    expect(composeIdentity({ files: files({}), surface: 'speaking' })).toBe('');
  });

  it('emits sections in a fixed order', () => {
    const out = composeIdentity({
      files: files({ agents: 'PROC', identity: 'ID', user: 'USR', soul: 'SOUL' }),
      surface: 'speaking',
    });
    expect(out.indexOf('ID')).toBeLessThan(out.indexOf('SOUL'));
    expect(out.indexOf('SOUL')).toBeLessThan(out.indexOf('PROC'));
    expect(out.indexOf('PROC')).toBeLessThan(out.indexOf('USR'));
  });

  it('omits empty and whitespace-only files entirely', () => {
    const out = composeIdentity({ files: files({ soul: 'SOUL', user: '   ' }), surface: 'speaking' });
    expect(out).toContain('SOUL');
    expect(out).not.toContain("WHO YOU'RE HELPING");
  });

  it('excludes tools on the speaking surface and includes it on acting', () => {
    const f = files({ soul: 'SOUL', tools: 'ENVNOTE' });
    expect(composeIdentity({ files: f, surface: 'speaking' })).not.toContain('ENVNOTE');
    expect(composeIdentity({ files: f, surface: 'acting' })).toContain('ENVNOTE');
  });

  it('includes heartbeat only on the scheduled surface', () => {
    const f = files({ soul: 'SOUL', heartbeat: 'CHECKLIST' });
    expect(composeIdentity({ files: f, surface: 'acting' })).not.toContain('CHECKLIST');
    expect(composeIdentity({ files: f, surface: 'scheduled' })).toContain('CHECKLIST');
  });

  it('lets agentsOverride replace the agents file', () => {
    const out = composeIdentity({
      files: files({ agents: 'SAVED' }),
      surface: 'speaking',
      agentsOverride: 'OVERRIDDEN',
    });
    expect(out).toContain('OVERRIDDEN');
    expect(out).not.toContain('SAVED');
  });

  it('uses agentsOverride even when no agents file exists', () => {
    const out = composeIdentity({ files: files({}), surface: 'speaking', agentsOverride: 'ONLY' });
    expect(out).toContain('ONLY');
  });

  it('truncates a single over-cap file with a visible marker', () => {
    const out = composeIdentity({ files: files({ soul: 'x'.repeat(5000) }), surface: 'speaking' });
    expect(out).toContain('<!-- truncated: soul exceeded 4000 chars -->');
    expect(out).not.toContain('x'.repeat(4001));
  });

  it('truncates against the total cap with a visible marker', () => {
    const out = composeIdentity({
      files: files({ soul: 'a'.repeat(400), agents: 'b'.repeat(400) }),
      surface: 'speaking',
      totalCap: 500,
    });
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain('<!-- truncated: workspace exceeded 500 chars -->');
  });
});

describe('non-regression guarantee (spec §7.4)', () => {
  it('composes nothing for a tenant with no workspace files, on every surface', () => {
    const empty = new Map<WorkspaceSlug, string>();
    expect(composeIdentity({ files: empty, surface: 'speaking' })).toBe('');
    expect(composeIdentity({ files: empty, surface: 'acting' })).toBe('');
    expect(composeIdentity({ files: empty, surface: 'scheduled' })).toBe('');
  });
});
