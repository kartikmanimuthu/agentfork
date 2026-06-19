import { describe, it, expect } from 'vitest';
import { secretDetectRule } from './secret-detect';
import { defaultGuardrailsConfig } from '../config/schema';
import type { RuleContext } from './types';

const ctx = (phase: 'input' | 'output'): RuleContext => ({
  config: defaultGuardrailsConfig(), tenantId: 't1', agentId: 'a1', phase,
});

describe('secretDetectRule', () => {
  it('flags an AWS access key id', async () => {
    const c = ctx('input'); c.config.input.secretDetection.enabled = true; c.config.input.secretDetection.action = 'mask';
    const r = await secretDetectRule.evaluate('key=AKIAIOSFODNN7EXAMPLE', c);
    expect(r.matched).toBe(true);
    expect(r.maskedText).toBe('key=[REDACTED]');
    expect(r.flagsSuspicion).toBe(true);
  });

  it('flags a private key header', async () => {
    const c = ctx('output'); c.config.output.secretDetection.enabled = true;
    const r = await secretDetectRule.evaluate('-----BEGIN RSA PRIVATE KEY-----', c);
    expect(r.matched).toBe(true);
  });

  it('passes when disabled', async () => {
    const c = ctx('input');
    const r = await secretDetectRule.evaluate('AKIAIOSFODNN7EXAMPLE', c);
    expect(r.matched).toBe(false);
  });
});