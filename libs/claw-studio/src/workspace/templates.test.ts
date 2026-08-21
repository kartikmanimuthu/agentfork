import { describe, expect, it } from 'vitest';
import { SLUG_CHAR_CAPS, SLUG_LABELS, WORKSPACE_SLUGS, isWorkspaceSlug } from './types';
import { WORKSPACE_TEMPLATES } from './templates';

describe('workspace slugs', () => {
  it('declares all six slugs in display order', () => {
    expect(WORKSPACE_SLUGS).toEqual(['identity', 'soul', 'agents', 'user', 'tools', 'heartbeat']);
  });

  it('has a cap, a label, and a template for every slug', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(SLUG_CHAR_CAPS[slug]).toBeGreaterThan(0);
      expect(SLUG_LABELS[slug].title.length).toBeGreaterThan(0);
      expect(WORKSPACE_TEMPLATES[slug]).toBeTypeOf('string');
    }
  });

  it('ships every template within its own cap', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(WORKSPACE_TEMPLATES[slug].length).toBeLessThanOrEqual(SLUG_CHAR_CAPS[slug]);
    }
  });

  it('guards unknown slugs', () => {
    expect(isWorkspaceSlug('soul')).toBe(true);
    expect(isWorkspaceSlug('memory')).toBe(false);
    expect(isWorkspaceSlug(null)).toBe(false);
  });
});
