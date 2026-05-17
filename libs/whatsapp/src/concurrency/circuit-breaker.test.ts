import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  it('starts in closed state', () => {
    expect(breaker.isOpen()).toBe(false);
  });

  it('stays closed below failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('opens after reaching failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('resets failure count on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('transitions to half-open after reset timeout', async () => {
    breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    expect(breaker.isOpen()).toBe(false);
  });

  it('re-opens on failure in half-open state', async () => {
    breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 60));

    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });
});
