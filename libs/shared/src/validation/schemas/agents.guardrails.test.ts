import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from './agents';

describe('validateAgentConfig guardrails', () => {
  it('accepts a valid guardrails config', () => {
    const r = validateAgentConfig({ model: 'm', systemPrompt: 'x', guardrails: { enabled: true } });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid guardrails config', () => {
    const r = validateAgentConfig({ model: 'm', systemPrompt: 'x', guardrails: { enabled: 'maybe' } });
    expect(r.success).toBe(false);
  });

  it('accepts config without guardrails', () => {
    const r = validateAgentConfig({ model: 'm', systemPrompt: 'x' });
    expect(r.success).toBe(true);
  });

  it('normalizes a partial guardrails config so nested guards are present', () => {
    const r = validateAgentConfig({ model: 'm', systemPrompt: 'x', guardrails: { enabled: true } });
    expect(r.success).toBe(true);
    if (r.success) {
      const gr = (r.data as { guardrails: { input: { piiRedaction?: { enabled?: boolean } } } }).guardrails;
      // Without normalization, `input` would be `{}` (cascade gap) and `piiRedaction` undefined.
      expect(gr.input.piiRedaction).toBeDefined();
      expect(gr.input.piiRedaction?.enabled).toBe(false);
    }
  });
});