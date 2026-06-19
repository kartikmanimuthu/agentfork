import { describe, it, expect } from 'vitest';
import { guardrailsConfigSchema, defaultGuardrailsConfig } from './guardrails';

describe('guardrailsConfigSchema', () => {
  it('accepts the default config', () => {
    expect(guardrailsConfigSchema.safeParse(defaultGuardrailsConfig()).success).toBe(true);
  });

  it('requires enabled to be a boolean', () => {
    const r = guardrailsConfigSchema.safeParse({ enabled: 'yes' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.input.secretDetection.action = 'delete' as any;
    expect(guardrailsConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it('accepts custom PII patterns', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.input.piiRedaction.enabled = true;
    cfg.input.piiRedaction.customPatterns = ['\\bPASS\\d+\\b'];
    expect(guardrailsConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('topic fence mode is one of keyword|judge|both', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.input.topicFence.mode = 'ai' as any;
    expect(guardrailsConfigSchema.safeParse(cfg).success).toBe(false);
  });
});