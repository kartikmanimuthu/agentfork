import { describe, it, expect } from 'vitest';
import { createRouter } from './factory';

describe('createRouter', () => {
  it('returns a KeywordRouter for keyword strategy', () => {
    const router = createRouter('keyword');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('KeywordRouter');
  });

  it('returns a MenuRouter for menu strategy', () => {
    const router = createRouter('menu');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('MenuRouter');
  });

  it('returns a TimeRouter for time_based strategy', () => {
    const router = createRouter('time_based');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('TimeRouter');
  });

  it('returns an AiIntentRouter for ai_intent strategy', () => {
    const router = createRouter('ai_intent');
    expect(router).toBeDefined();
    expect(router.constructor.name).toBe('AiIntentRouter');
  });

  it('throws for unknown strategy', () => {
    expect(() => createRouter('unknown')).toThrow('Unknown routing strategy: unknown');
  });
});
