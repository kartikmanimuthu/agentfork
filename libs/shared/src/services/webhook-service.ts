import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import { createLogger } from '../logging/logger';

const logger = createLogger('webhook-service');

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  const firstGroup = normalized.split(':')[0];
  const firstHextet = parseInt(firstGroup || '0', 16);
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);

async function assertPublicWebhookUrl(webhookUrl: string): Promise<void> {
  const url = new URL(webhookUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https');
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Webhook URL resolves to a disallowed address');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Webhook URL resolves to a disallowed address');
    return;
  }
  const records = await dns.promises.lookup(hostname, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new Error('Webhook URL resolves to a disallowed address');
  }
}

export interface WebhookPayload {
  executionId: string;
  agentId: string;
  agentVersionId?: string;
  /** Transcription only — the caller's stable upload identifier. */
  uploadId?: string;
  /** Transcription only — the caller's own reference, echoed back verbatim. */
  clientReference?: string;
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
  private async send(
    webhookUrl: string,
    headers: Record<string, string>,
    body: string
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    try {
      await assertPublicWebhookUrl(webhookUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook URL failed safety check';
      logger.warn({ webhookUrl, errorMessage: message }, 'Blocked webhook delivery to disallowed address');
      return { success: false, error: message };
    }

    try {
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

  /** HMAC-signed delivery (Agent Inference webhooks). */
  async deliver(
    webhookUrl: string,
    webhookSecret: string | null,
    payload: WebhookPayload
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'chatbot-inference/1.0',
      'X-Webhook-Timestamp': String(timestamp),
    };

    if (webhookSecret) {
      // v1: unchanged for existing consumers — HMAC over the raw body alone.
      const signature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;

      // v2: Stripe-style timestamped signature (`t=<ts>,v1=<hmac(ts.body)>`) — signing in
      // the timestamp lets the receiver reject stale/replayed deliveries. New consumers
      // should verify this one; verifySignature() below supports both.
      const signedPayload = `${timestamp}.${body}`;
      const signatureV2 = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
      headers['X-Webhook-Signature-V2'] = `t=${timestamp},v1=${signatureV2}`;
    }

    return this.send(webhookUrl, headers, body);
  }

  /** Static bearer-token delivery (Transcription webhooks): `Authorization: Bearer <token>`, no signing. */
  async deliverWithToken(
    webhookUrl: string,
    webhookToken: string | null,
    payload: WebhookPayload
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'chatbot-inference/1.0',
    };

    if (webhookToken) {
      headers['Authorization'] = `Bearer ${webhookToken}`;
    }

    return this.send(webhookUrl, headers, body);
  }

  /** Legacy v1 verification: bare hex HMAC over the raw body (no replay protection). */
  verifySignature(body: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  /**
   * v2 verification: parses `X-Webhook-Signature-V2: t=<ts>,v1=<hex>`, recomputes
   * HMAC(secret, `${t}.${body}`), and rejects timestamps older than `toleranceSeconds`
   * (replay protection). Returns false on any malformed input rather than throwing.
   */
  verifySignatureV2(body: string, headerValue: string, secret: string, toleranceSeconds = 300): boolean {
    const parts = Object.fromEntries(
      headerValue.split(',').map((kv) => kv.split('=') as [string, string])
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
    if (!Number.isFinite(age) || age > toleranceSeconds) return false;

    const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    if (v1.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  }
}
