export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failureCount = 0;
  private lastFailureAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  isOpen(): boolean {
    if (this.state === 'closed') return false;

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }

    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    if (this.state === 'half_open' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }
}
