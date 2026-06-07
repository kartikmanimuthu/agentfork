import type { PrismaClient } from '@prisma/client';
import type { AgentExecutor } from './message-processor';

export type LlmProviderFactory = (config: { model: string; temperature?: number }) => {
  chat(params: { messages: Array<{ role: string; content: string }>; maxTokens?: number }): Promise<{ text: string }>;
};

export class TelegramAgentExecutorImpl implements AgentExecutor {
  private readonly prisma: PrismaClient;
  private readonly providerFactory: LlmProviderFactory;

  constructor(prisma: PrismaClient, providerFactory: LlmProviderFactory) {
    this.prisma = prisma;
    this.providerFactory = providerFactory;
  }

  async execute(
    agentId: string,
    message: { text?: string; mediaUrl?: string; mediaType?: string; mediaId?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const agent = await (this.prisma as any).agent.findFirst({
      where: { id: agentId },
    });

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.type === 'simple') {
      return this.executeSimpleAgent(agent, message, context);
    }

    if (agent.type === 'graph') {
      return this.executeGraphAgent(agent, message, context);
    }

    throw new Error(`Unsupported agent type: ${agent.type}`);
  }

  private async executeSimpleAgent(
    agent: { id: string; config: any },
    message: { text?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const config = agent.config as { model: string; systemPrompt: string; temperature?: number; maxTokens?: number };
    const provider = this.providerFactory({ model: config.model, temperature: config.temperature });

    const messages: Array<{ role: string; content: string }> = [];
    messages.push({ role: 'system', content: config.systemPrompt });

    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    messages.push(...history);

    if (message.text) {
      messages.push({ role: 'user', content: message.text });
    }

    const result = await provider.chat({ messages, maxTokens: config.maxTokens });
    return { text: result.text };
  }

  private async executeGraphAgent(
    agent: { id: string; config: any },
    message: { text?: string; mediaId?: string; mediaType?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — dynamic import to avoid circular dependency at build time
    const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');

    const graphDef = agent.config as { nodes: any[]; edges: any[] };

    const entryNode =
      graphDef.nodes.find((n: any) => n.type === 'telegram_trigger') ??
      graphDef.nodes.find((n: any) => graphDef.edges.every((e: any) => e.target !== n.id));

    if (!entryNode) throw new Error(`Graph agent ${agent.id} has no entry node`);

    const initialState = {
      channels: {
        tg_chat_id: context['tg_chat_id'] ?? '',
        tg_text: message.text ?? '',
        tg_message_type: context['tg_message_type'] ?? 'text',
        tg_media_id: context['tg_media_id'] ?? null,
        tg_callback_data: context['tg_callback_data'] ?? null,
        tg_from_id: context['tg_from_id'] ?? '',
        tg_from_name: context['tg_from_name'] ?? '',
        tg_account_id: context['tg_account_id'] ?? '',
        tg_session_id: context['tg_session_id'] ?? '',
        tg_is_group: context['tg_is_group'] ?? false,
        messages: (context['messages'] as any[]) ?? [],
      },
      messages: [
        ...((context['messages'] as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) ?? []),
        ...(message.text ? [{ role: 'user' as const, content: message.text }] : []),
      ],
      currentNodeId: entryNode.id as string,
      metadata: {
        executionId: crypto.randomUUID(),
        agentId: agent.id,
        tenantId: (context['tenantId'] as string) ?? '',
        userId: 'telegram',
        startedAt: new Date(),
      },
    };

    const providerFactory = this.providerFactory;
    const executor = new GraphExecutor({
      llmProvider: async (_providerId?: string, modelId?: string) =>
        providerFactory({ model: modelId ?? 'claude-sonnet-4-6' }),
      prisma: this.prisma,
    });

    for (const nodeExecutor of createNodeExecutors()) {
      executor.register(nodeExecutor);
    }

    const finalState = await executor.executeFromState(
      graphDef,
      initialState,
      initialState.metadata,
    );

    if (finalState.channels['tg_last_sent_message_id']) {
      return { text: '' };
    }

    const responseText =
      String(finalState.channels['response'] ?? finalState.channels['llm_output'] ?? '');

    return { text: responseText };
  }
}
