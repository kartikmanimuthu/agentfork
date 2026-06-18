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

      // Resolve any configured tool names against the execution tool registry.
      const registry = ctx.services.toolRegistry;
      const requestedTools = config.tools ?? [];
      const tools: Record<string, unknown> = {};
      const missingTools: string[] = [];
      for (const toolName of requestedTools) {
        const tool = registry?.[toolName];
        if (tool) {
          tools[toolName] = tool;
        } else {
          missingTools.push(toolName);
        }
      }
      if (missingTools.length > 0) {
        logger.warn(
          { nodeId: ctx.node.id, missingTools },
          'llm node references tools that are not in the registry',
        );
      }
      const hasTools = Object.keys(tools).length > 0;

      const streamResult = provider.streamChat({
        messages,
        system: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        ...(hasTools ? { tools, maxSteps: 5 } : {}),
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
          input: { messageCount: messages.length, model: config.model, toolCount: Object.keys(tools).length },
          output: { responseLength: fullText.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'llm execution failed');
      throw error;
    }
  }
}
