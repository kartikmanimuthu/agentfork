import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { InputNodeConfig } from '../../types/nodes';

export class InputNodeExecutor implements NodeExecutor {
  type = 'input';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as InputNodeConfig;
    const startedAt = new Date().toISOString();

    const messages = ctx.state.messages ?? [];
    const updates: Record<string, unknown> = { messages };

    if (config.mode === 'structured' && config.inputSchema?.length) {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMessage) {
        for (const field of config.inputSchema) {
          if (ctx.state.channels[field.name] === undefined) {
            updates[field.name] = lastUserMessage.content;
          }
        }
      }
    }

    return {
      stateUpdates: updates,
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'input',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { mode: config.mode, messageCount: messages.length },
        output: { channelsWritten: Object.keys(updates) },
      },
    };
  }
}
