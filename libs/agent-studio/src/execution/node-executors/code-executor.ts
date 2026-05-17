import pino from 'pino';
import { runInNewContext } from 'node:vm';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { CodeNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'code-executor' });

export class CodeNodeExecutor implements NodeExecutor {
  type = 'code';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as CodeNodeConfig;
    const startedAt = new Date().toISOString();

    const sandbox: Record<string, unknown> = {};
    for (const channel of config.inputChannels) {
      sandbox[channel] = ctx.state.channels[channel] ?? null;
    }

    const timeout = config.timeoutMs ?? 5000;

    try {
      const result = runInNewContext(config.code, sandbox, { timeout });

      logger.info({ nodeId: ctx.node.id, outputChannel: config.outputChannel }, 'Code executed successfully');

      return {
        stateUpdates: { [config.outputChannel]: result },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'code',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { language: config.language, inputChannels: config.inputChannels },
          output: { result },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'Code execution failed');
      throw error;
    }
  }
}
