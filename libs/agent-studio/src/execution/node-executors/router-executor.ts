import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { RouterNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:router-executor');

export class RouterNodeExecutor implements NodeExecutor {
  type = 'router';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as RouterNodeConfig;
    const startedAt = new Date().toISOString();

    const mode = config.mode ?? 'expression';
    const matchedTarget = mode === 'natural_language'
      ? await this.evaluateNaturalLanguage(config, ctx)
      : this.evaluateExpressions(config, ctx);

    if (!matchedTarget) {
      const error = `router node "${ctx.node.id}": no condition matched and no default target`;
      logger.error({ nodeId: ctx.node.id, mode }, error);
      throw new Error(error);
    }

    logger.info({ nodeId: ctx.node.id, matchedTarget, mode }, 'router condition matched');

    return {
      stateUpdates: {},
      next: [matchedTarget],
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'router',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { conditionCount: config.conditions.length, mode },
        output: { matchedTarget },
      },
    };
  }

  private evaluateExpressions(
    config: RouterNodeConfig,
    ctx: NodeExecutionContext,
  ): string | null {
    for (const { condition, target } of config.conditions) {
      if (this.evalExpression(condition, ctx.state.channels)) {
        return target;
      }
    }
    return config.defaultTarget ?? null;
  }

  private evalExpression(expression: string, channels: Record<string, unknown>): boolean {
    try {
      const fn = new Function(...Object.keys(channels), `return Boolean(${expression})`);
      return fn(...Object.values(channels));
    } catch (error) {
      logger.warn({ expression, error }, 'condition evaluation failed');
      return false;
    }
  }

  private async evaluateNaturalLanguage(
    config: RouterNodeConfig,
    ctx: NodeExecutionContext,
  ): Promise<string | null> {
    try {
      const provider = await ctx.services.llmProvider();

      const channelSummary = Object.entries(ctx.state.channels)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n');

      const conditionList = config.conditions
        .map((c, i) => `${i}: ${c.condition}`)
        .join('\n');

      const prompt = `You are a routing classifier. Based on the current context, determine which routing condition (if any) best matches.

Current context:
${channelSummary || '(no channel data)'}

Routing conditions:
${conditionList}

Respond with ONLY a single integer:
- The 0-based index of the best matching condition
- Or -1 if none of the conditions match

No explanation. Just the number.`;

      const streamResult = provider.streamChat({
        messages: [{ role: 'user', content: prompt }],
        temperature: config.nlTemperature ?? 0,
        maxOutputTokens: 10,
      });

      let response = '';
      for await (const chunk of streamResult.textStream) {
        response += chunk;
      }

      const index = parseInt(response.trim(), 10);

      logger.info(
        { nodeId: ctx.node.id, response: response.trim(), parsedIndex: index },
        'NL router LLM response',
      );

      if (isNaN(index) || index < 0) {
        return config.defaultTarget ?? null;
      }

      const matched = config.conditions[index];
      return matched?.target ?? config.defaultTarget ?? null;
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'NL router LLM classification failed');
      throw error;
    }
  }
}
