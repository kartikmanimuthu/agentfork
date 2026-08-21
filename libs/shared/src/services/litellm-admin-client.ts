import { createLogger } from '../logging/logger';

const logger = createLogger('litellm-admin-client');

const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
const RETRY_BASE_DELAY_MS = 300;

export class LiteLLMProvisioningError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'LiteLLMProvisioningError';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiteLLMAdminClient {
  constructor(
    private readonly gatewayUrl: string,
    private readonly masterKey: string,
  ) {}

  private async requestWithRetry(path: string, body: Record<string, unknown>): Promise<any> {
    const url = `${this.gatewayUrl.replace(/\/$/, '')}${path}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.masterKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          logger.error({ url, status: res.status, attempt }, 'LiteLLM admin API returned an error status');
          throw new LiteLLMProvisioningError(`LiteLLM admin API error: ${res.status} ${res.statusText}`);
        }
        return res.json();
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof LiteLLMProvisioningError) throw error;
        lastError = error;
        logger.error({ url, attempt, error: error instanceof Error ? error.message : error }, 'LiteLLM admin API request failed');
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }

    throw new LiteLLMProvisioningError('LiteLLM admin API unreachable after retries', lastError);
  }

  async generateVirtualKey(opts: {
    tenantId: string;
    keyAlias: string;
    maxBudgetUsd?: number;
  }): Promise<{ key: string }> {
    logger.info({ tenantId: opts.tenantId, keyAlias: opts.keyAlias }, 'Generating LiteLLM virtual key');
    const data = await this.requestWithRetry('/key/generate', {
      key_alias: opts.keyAlias,
      max_budget: opts.maxBudgetUsd,
      metadata: { tenantId: opts.tenantId },
    });
    logger.info({ tenantId: opts.tenantId, keyAlias: opts.keyAlias }, 'Generated LiteLLM virtual key');
    return { key: data.key };
  }

  async revokeVirtualKey(keyAlias: string): Promise<void> {
    logger.info({ keyAlias }, 'Revoking LiteLLM virtual key');
    await this.requestWithRetry('/key/delete', { key_aliases: [keyAlias] });
    logger.info({ keyAlias }, 'Revoked LiteLLM virtual key');
  }
}
