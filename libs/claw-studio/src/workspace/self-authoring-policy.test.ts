import { describe, expect, it } from 'vitest';
import {
  FREE_WRITE_SLUGS, GATED_WRITE_SLUGS, MAX_WRITES_PER_RUN, canClawWrite, isFreeWrite,
} from './self-authoring-policy';
import { WORKSPACE_SLUGS } from './types';

describe('self-authoring policy', () => {
  it('partitions every slug into exactly one of free or gated', () => {
    const all = [...FREE_WRITE_SLUGS, ...GATED_WRITE_SLUGS].sort();
    expect(all).toEqual([...WORKSPACE_SLUGS].sort());
    expect(new Set(all).size).toBe(WORKSPACE_SLUGS.length);
  });

  it('treats user, tools and heartbeat as free writes', () => {
    expect(isFreeWrite('user')).toBe(true);
    expect(isFreeWrite('tools')).toBe(true);
    expect(isFreeWrite('heartbeat')).toBe(true);
  });

  it('treats identity, soul and agents as gated writes', () => {
    expect(isFreeWrite('soul')).toBe(false);
    expect(isFreeWrite('agents')).toBe(false);
    expect(isFreeWrite('identity')).toBe(false);
  });

  it('blocks every write when mode is off', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(canClawWrite(slug, 'off')).toBe(false);
    }
  });

  it('allows only free slugs when mode is user', () => {
    expect(canClawWrite('user', 'user')).toBe(true);
    expect(canClawWrite('tools', 'user')).toBe(true);
    expect(canClawWrite('heartbeat', 'user')).toBe(true);
    expect(canClawWrite('soul', 'user')).toBe(false);
    expect(canClawWrite('agents', 'user')).toBe(false);
    expect(canClawWrite('identity', 'user')).toBe(false);
  });

  it('allows every slug when mode is all', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(canClawWrite(slug, 'all')).toBe(true);
    }
  });

  it('caps writes per run', () => {
    expect(MAX_WRITES_PER_RUN).toBe(5);
  });
});
