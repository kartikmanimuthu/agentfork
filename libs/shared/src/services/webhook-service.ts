import crypto from 'crypto';

export interface WebhookPayload {
  executionId: string;
  agentId: string;
  agentVersionId?: string;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  cacheHit: boolean;
  latencyMs?: number;
  timestamp: string;
}

export class WebhookService {
  async deliver(
    webhookUrl: string,
    webhookSecret: string | null,
    payload: WebhookPayload
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'chatbot-inference/1.0',
      };

      if (webhookSecret) {
        const signature = crypto
          .createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex');
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });

      return {
        success: response.ok,
        status: response.status,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Webhook delivery failed',
      };
    }
  }

  verifySignature(
    body: string,
    signature: string,
    secret: string
  ): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }
}
