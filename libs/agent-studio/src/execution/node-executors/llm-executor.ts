import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { LlmNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:llm-executor');

export class LlmNodeExecutor implements NodeExecutor {
  type = 'llm';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as LlmNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const provider = await ctx.services.llmProvider(undefined, config.model);

      const messages = ctx.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const streamResult = provider.streamChat({
        messages,
        system: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      });

      let fullText = '';
      for await (const chunk of streamResult.textStream) {
        fullText += chunk;
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: chunk });
      }

      logger.info(
        { nodeId: ctx.node.id, model: config.model, responseLength: fullText.length },
        'llm execution completed',
      );

      return {
        stateUpdates: { response: fullText },
        next: null,
        output: fullText,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'llm',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { messageCount: messages.length, model: config.model },
          output: { responseLength: fullText.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'llm execution failed');
      throw error;
    }
  }
}
