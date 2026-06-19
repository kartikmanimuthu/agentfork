import { describe, it, expect } from 'vitest';
import { outputLooksSuspicious } from './heuristic';
import { defaultGuardrailsConfig } from '../config/schema';

describe('outputLooksSuspicious', () => {
  it('flags a banned keyword', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.output.bannedPhrases.phrases = ['secretword'];
    expect(outputLooksSuspicious('this has secretword in it', cfg)).toBe(true);
  });

  it('flags secret-like patterns', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.output.secretDetection.enabled = true;
    expect(outputLooksSuspicious('key=AKIAIOSFODNN7EXAMPLE', cfg)).toBe(true);
  });

  it('does not flag clean text', () => {
    const cfg = defaultGuardrailsConfig();
    cfg.output.bannedPhrases.phrases = ['secretword'];
    expect(outputLooksSuspicious('a perfectly normal answer', cfg)).toBe(false);
  });
});