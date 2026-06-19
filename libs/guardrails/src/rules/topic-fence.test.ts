import { describe, it, expect } from 'vitest';
import { topicFenceRule } from './topic-fence';
import { defaultGuardrailsConfig } from '../config/schema';
import type { RuleContext } from './types';

const ctx = (phase: 'input' | 'output'): RuleContext => ({
  config: defaultGuardrailsConfig(), tenantId: 't1', agentId: 'a1', phase,
});

describe('topicFenceRule (keyword mode)', () => {
  it('flags a denied subject', async () => {
    const c = ctx('input');
    c.config.input.topicFence.deniedSubjects = ['competitor'];
    c.config.input.topicFence.mode = 'keyword';
    const r = await topicFenceRule.evaluate('how does competitor compare?', c);
    expect(r.matched).toBe(true);
    expect(r.action).toBe('block');
  });

  it('flags off-topic when allowedSubjects set', async () => {
    const c = ctx('input');
    c.config.input.topicFence.allowedSubjects = ['billing', 'shipping'];
    c.config.input.topicFence.mode = 'keyword';
    const r = await topicFenceRule.evaluate('what is the weather today?', c);
    expect(r.matched).toBe(true); // none of allowed subjects present
  });

  it('passes on-topic', async () => {
    const c = ctx('input');
    c.config.input.topicFence.allowedSubjects = ['billing'];
    c.config.input.topicFence.mode = 'keyword';
    const r = await topicFenceRule.evaluate('help with my billing', c);
    expect(r.matched).toBe(false);
  });
});