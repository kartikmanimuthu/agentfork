import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { MemoryNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:memory-executor');

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class MemoryNodeExecutor implements NodeExecutor {
  type = 'memory';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as MemoryNodeConfig;
    const startedAt = new Date().toISOString();
    try {
      const raw = ctx.state.channels[config.messagesChannel] ?? ctx.state.messages;
      const messages: Message[] = Array.isArray(raw) ? (raw as Message[]) : [];

      const processed =
        config.strategy === 'summary'
          ? await this.applySummaryStrategy(messages, config, ctx)
          : this.applyStrategy(messages, config);

      logger.info(
        { nodeId: ctx.node.id, strategy: config.strategy, input: messages.length, output: processed.length },
        'memory strategy applied',
      );

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
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'memory execution failed');
      throw error;
    }
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

      default:
        return messages;
    }
  }

  private async applySummaryStrategy(
    messages: Message[],
    config: MemoryNodeConfig,
    ctx: NodeExecutionContext,
  ): Promise<Message[]> {
    const keepRecent = config.keepRecent ?? 6;

    if (messages.length <= keepRecent) {
      return messages;
    }

    const old = messages.slice(0, messages.length - keepRecent);
    const recent = messages.slice(-keepRecent);

    try {
      const provider = await ctx.services.llmProvider();

      const conversationText = old
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const streamResult = provider.streamChat({
        messages: [
          {
            role: 'user',
            content: `Summarize the following conversation concisely, preserving key facts and context:\n\n${conversationText}`,
          },
        ],
        temperature: 0,
        maxOutputTokens: 512,
      });

      let summary = '';
      for await (const chunk of streamResult.textStream) {
        summary += chunk;
      }

      logger.info(
        { nodeId: ctx.node.id, oldCount: old.length, keepRecent, summaryLength: summary.length },
        'memory summary generated',
      );

      return [
        { role: 'system', content: `Summary of earlier conversation:\n${summary}` },
        ...recent,
      ];
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'memory summary LLM call failed');
      throw error;
    }
  }
}
