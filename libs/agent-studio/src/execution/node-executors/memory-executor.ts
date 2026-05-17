import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { MemoryNodeConfig } from '../../types/nodes';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class MemoryNodeExecutor implements NodeExecutor {
  type = 'memory';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as MemoryNodeConfig;
    const startedAt = new Date().toISOString();

    const raw = ctx.state.channels[config.messagesChannel] ?? ctx.state.messages;
    const messages: Message[] = Array.isArray(raw) ? (raw as Message[]) : [];

    const processed = this.applyStrategy(messages, config);

    return {
      stateUpdates: { [config.messagesChannel]: processed },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'memory',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { strategy: config.strategy, originalCount: messages.length },
        output: { resultCount: processed.length },
      },
    };
  }

  private applyStrategy(messages: Message[], config: MemoryNodeConfig): Message[] {
    switch (config.strategy) {
      case 'full':
        return messages;

      case 'sliding_window': {
        const max = config.maxMessages ?? 20;
        return messages.slice(-max);
      }

      case 'token_limit': {
        const limit = config.maxTokens ?? 4000;
        const result: Message[] = [];
        let tokens = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          const estimated = Math.ceil(messages[i].content.length / 4);
          if (tokens + estimated > limit) break;
          tokens += estimated;
          result.unshift(messages[i]);
        }
        return result;
      }

      case 'summary':
        return messages;

      default:
        return messages;
    }
  }
}
