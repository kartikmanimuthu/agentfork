import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { SubAgentNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:sub-agent-executor');

export class SubAgentNodeExecutor implements NodeExecutor {
  type = 'sub_agent';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as SubAgentNodeConfig;
    const startedAt = new Date().toISOString();

    const input = ctx.state.channels[config.inputChannel] ?? null;

    logger.warn(
      { nodeId: ctx.node.id, agentId: config.agentId },
      'Sub-agent invocation is a placeholder — recursive execution not yet implemented'
    );

    return {
      stateUpdates: { [config.outputChannel]: null },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'sub_agent',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { agentId: config.agentId, inputChannel: config.inputChannel, inputValue: input },
        output: { result: null },
      },
    };
  }
}
