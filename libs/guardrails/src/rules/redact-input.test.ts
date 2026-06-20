import { describe, it, expect } from 'vitest';
import { redactInputPiiAndSecrets } from './redact-input';
import { defaultGuardrailsConfig } from '../config/schema';
import type { GuardrailsConfig } from '../config/schema';

describe('redactInputPiiAndSecrets', () => {
  it('masks an SSN when PII redaction is enabled', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    cfg.input.piiRedaction.enabled = true;
    const out = redactInputPiiAndSecrets('my SSN is 123-45-6789', cfg);
    expect(out).toBe('my SSN is [SSN]');
    expect(out).not.toContain('123-45-6789');
  });

  it('masks an AWS access key when secret detection is enabled', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    cfg.input.secretDetection.enabled = true;
    cfg.input.secretDetection.action = 'mask';
    const out = redactInputPiiAndSecrets('key=AKIAIOSFODNN7EXAMPLE', cfg);
    expect(out).toBe('key=[REDACTED]');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks secrets even when action is block (persistence must not leak raw on block path)', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    cfg.input.secretDetection.enabled = true;
    cfg.input.secretDetection.action = 'block';
    const out = redactInputPiiAndSecrets('token=AKIAIOSFODNN7EXAMPLE', cfg);
    expect(out).toBe('token=[REDACTED]');
  });

  it('masks both PII and secrets when both are enabled', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    cfg.input.piiRedaction.enabled = true;
    cfg.input.secretDetection.enabled = true;
    cfg.input.secretDetection.action = 'mask';
    const out = redactInputPiiAndSecrets('email a@b.com key=AKIAIOSFODNN7EXAMPLE', cfg);
    expect(out).toBe('email [EMAIL] key=[REDACTED]');
  });

  it('passes text through unchanged when redactions are disabled', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.enabled = true;
    // both input.piiRedaction.enabled and input.secretDetection.enabled default false
    const text = 'my SSN is 123-45-6789 and key=AKIAIOSFODNN7EXAMPLE';
    const out = redactInputPiiAndSecrets(text, cfg);
    expect(out).toBe(text);
  });

  it('redacts based on section flags, not the top-level enabled flag (route gates top-level)', () => {
    const cfg: GuardrailsConfig = defaultGuardrailsConfig();
    cfg.enabled = false;
    cfg.input.piiRedaction.enabled = true;
    cfg.input.secretDetection.enabled = true;
    const text = 'my SSN is 123-45-6789';
    const out = redactInputPiiAndSecrets(text, cfg);
    // The helper only checks the per-section enabled flags; the route gates on
    // `guardrailsCtx?.config.enabled` before calling, so the top-level flag is
    // not re-checked here. Verify the helper redacts when section flags are on.
    expect(out).toBe('my SSN is [SSN]');
  });
});