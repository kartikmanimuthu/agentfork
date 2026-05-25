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

      let messages = ctx.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextChannels = config.contextChannels ?? [];
      const channelContents = contextChannels
        .map((ch) => ({ ch, content: ctx.state.channels[ch] }))
        .filter(
          (e): e is { ch: string; content: string } =>
            typeof e.content === 'string' && e.content.trim().length > 0,
        );

      if (channelContents.length > 0) {
        const lastUserIdx = messages.reduce<number>(
          (found, m, i) => (m.role === 'user' ? i : found),
          -1,
        );

        if (lastUserIdx !== -1) {
          const docBlock = channelContents
            .map((e, i) => `<document index="${i + 1}">\n${e.content}\n</document>`)
            .join('\n');
          const xmlBlock = `<documents>\n${docBlock}\n</documents>`;

          messages = [
            ...messages.slice(0, lastUserIdx),
            { ...messages[lastUserIdx], content: `${xmlBlock}\n\n${messages[lastUserIdx].content}` },
            ...messages.slice(lastUserIdx + 1),
          ];

          logger.debug(
            { nodeId: ctx.node.id, channels: contextChannels, docCount: channelContents.length },
            'injected context channels into last user message',
          );
        } else {
          logger.warn(
            { nodeId: ctx.node.id, channels: contextChannels },
            'contextChannels configured but no user message found to inject into — skipping',
          );
        }
      }

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
