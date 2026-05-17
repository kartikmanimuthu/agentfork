import pino from 'pino';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { HttpNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'http-executor' });

export class HttpNodeExecutor implements NodeExecutor {
  type = 'http';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as HttpNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const url = this.interpolate(config.url, ctx.state.channels);

      let body: string | undefined;
      if (config.bodyChannel && ctx.state.channels[config.bodyChannel] != null) {
        const raw = ctx.state.channels[config.bodyChannel];
        body = typeof raw === 'string' ? raw : JSON.stringify(raw);
      } else if (config.bodyTemplate) {
        body = this.interpolate(config.bodyTemplate, ctx.state.channels);
      }

      const timeout = config.timeoutMs ?? 10000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: config.method,
        headers: config.headers,
        body: config.method !== 'GET' ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      logger.info({ nodeId: ctx.node.id, method: config.method, url, status: response.status }, 'HTTP request completed');

      return {
        stateUpdates: { [config.outputChannel]: parsed },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'http',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { method: config.method, url },
          output: { status: response.status, body: parsed },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'HTTP request failed');
      throw error;
    }
  }

  private interpolate(template: string, channels: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = channels[key];
      if (value == null) return '';
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }
}
