import { describe, it, expect } from 'vitest';
import { piiRedactRule } from './pii-redact';
import { defaultGuardrailsConfig } from '../config/schema';
import type { RuleContext } from './types';

const ctx = (phase: 'input' | 'output'): RuleContext => ({
  config: defaultGuardrailsConfig(),
  tenantId: 't1', agentId: 'a1', phase,
});

describe('piiRedactRule', () => {
  it('masks an email when enabled', async () => {
    const c = ctx('input'); c.config.input.piiRedaction.enabled = true;
    const r = await piiRedactRule.evaluate('mail me at a@b.com', c);
    expect(r.matched).toBe(true);
    expect(r.maskedText).toBe('mail me at [EMAIL]');
    expect(r.action).toBe('mask');
  });

  it('passes through when disabled', async () => {
    const c = ctx('input'); c.config.input.piiRedaction.enabled = false;
    const r = await piiRedactRule.evaluate('mail me at a@b.com', c);
    expect(r.matched).toBe(false);
  });

  it('applies custom patterns', async () => {
    const c = ctx('input'); c.config.input.piiRedaction.enabled = true;
    c.config.input.piiRedaction.customPatterns = ['PASS\\d+'];
    const r = await piiRedactRule.evaluate('see PASS1234', c);
    expect(r.maskedText).toBe('see [REDACTED]');
  });
});