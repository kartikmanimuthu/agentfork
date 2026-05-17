import pino from 'pino';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { KnowledgeBaseNodeConfig } from '../../types/nodes';

const logger = pino({ name: 'kb-executor' });

export class KnowledgeBaseNodeExecutor implements NodeExecutor {
  type = 'knowledge_base';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as KnowledgeBaseNodeConfig;
    const startedAt = new Date().toISOString();

    const query = this.resolveQuery(ctx, config);
    if (!query) {
      logger.warn({ nodeId: ctx.node.id }, 'No query found for knowledge base retrieval');
      return {
        stateUpdates: { [config.outputChannel]: '' },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'knowledge_base',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { query: null },
          output: { results: 0 },
        },
      };
    }

    try {
      const { RetrievalService } = await import('@chatbot/knowledge-base');
      const tenantId = ctx.state.metadata.tenantId as string;
      const retrieval = new RetrievalService(tenantId);

      let kbIds = config.knowledgeBaseIds;
      if (!kbIds.length) {
        const agentId = ctx.state.metadata.agentId as string;
        const attachments = await ctx.services.prisma.agentKnowledgeBase.findMany({
          where: { agentId },
          include: { knowledgeBase: true },
        });
        kbIds = attachments.map((a: { knowledgeBaseId: string }) => a.knowledgeBaseId);
      }

      const allResults: string[] = [];
      for (const kbId of kbIds) {
        const results = await retrieval.query(query, { knowledgeBaseId: kbId, topK: config.topK });
        for (const r of results) {
          allResults.push(r.content);
        }
      }

      const output = allResults.join('\n\n');
      logger.info({ nodeId: ctx.node.id, kbCount: kbIds.length, resultCount: allResults.length }, 'KB retrieval complete');

      return {
        stateUpdates: { [config.outputChannel]: output },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'knowledge_base',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { query, knowledgeBaseIds: kbIds },
          output: { results: allResults.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'KB retrieval failed');
      throw error;
    }
  }

  private resolveQuery(ctx: NodeExecutionContext, config: KnowledgeBaseNodeConfig): string | null {
    const channelValue = ctx.state.channels[config.queryChannel];
    if (channelValue && typeof channelValue === 'string') {
      return channelValue;
    }

    const messages = ctx.state.messages;
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === 'user') return last.content;
    }

    return null;
  }
}
