import pino from 'pino';
import crypto from 'node:crypto';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { HumanNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'human-executor' });

export class HumanNodeExecutor implements NodeExecutor {
  type = 'human';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as HumanNodeConfig;
    const startedAt = new Date().toISOString();
    const resumeToken = crypto.randomUUID();

    logger.info({ nodeId: ctx.node.id, resumeToken }, 'Pausing execution for human input');

    ctx.emit({ type: 'execution_paused', reason: config.prompt, resumeToken });

    return {
      stateUpdates: {
        __paused: true,
        __resumeToken: resumeToken,
      },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'human',
        nodeLabel: ctx.node.label,
        status: 'paused',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { prompt: config.prompt },
        output: { resumeToken },
      },
    };
  }
}
