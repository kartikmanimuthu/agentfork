import { describe, it, expect } from 'vitest';
import { keywordDenyRule } from './keyword-deny';
import { defaultGuardrailsConfig } from '../config/schema';
import type { RuleContext } from './types';

const ctx = (phase: 'input' | 'output'): RuleContext => ({
  config: defaultGuardrailsConfig(), tenantId: 't1', agentId: 'a1', phase,
});

describe('keywordDenyRule', () => {
  it('blocks a banned phrase configured to block', async () => {
    const c = ctx('input');
    c.config.input.bannedPhrases.phrases = ['forbidden word'];
    c.config.input.bannedPhrases.action = 'block';
    const r = await keywordDenyRule.evaluate('this is a forbidden word here', c);
    expect(r.matched).toBe(true);
    expect(r.action).toBe('block');
  });

  it('masks a banned phrase configured to mask', async () => {
    const c = ctx('input');
    c.config.input.bannedPhrases.phrases = ['forbidden word'];
    c.config.input.bannedPhrases.action = 'mask';
    const r = await keywordDenyRule.evaluate('this is a forbidden word here', c);
    expect(r.maskedText).toBe('this is a [REDACTED] here');
  });
});