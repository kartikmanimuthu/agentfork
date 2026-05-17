import type { PrismaClient } from '@prisma/client';
import type { AgentExecutor } from './message-processor';

export type LlmProviderFactory = (config: { model: string; temperature?: number }) => {
  chat(params: { messages: Array<{ role: string; content: string }>; maxTokens?: number }): Promise<{ text: string }>;
};

export class WhatsAppAgentExecutor implements AgentExecutor {
  private readonly prisma: PrismaClient;
  private readonly providerFactory: LlmProviderFactory;

  constructor(prisma: PrismaClient, providerFactory: LlmProviderFactory) {
    this.prisma = prisma;
    this.providerFactory = providerFactory;
  }

  async execute(
    agentId: string,
    message: { text?: string; mediaUrl?: string; mediaType?: string },
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
    message: { text?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const graphDef = agent.config as { nodes: any[]; edges: any[] };
    const entryNode = graphDef.nodes.find((n: any) => n.type === 'llm');

    if (!entryNode) {
      throw new Error(`Graph agent ${agent.id} has no LLM entry node`);
    }

    const nodeConfig = entryNode.config as { model: string; systemPrompt?: string; temperature?: number; maxTokens?: number };
    const provider = this.providerFactory({ model: nodeConfig.model, temperature: nodeConfig.temperature });

    const messages: Array<{ role: string; content: string }> = [];
    if (nodeConfig.systemPrompt) {
      messages.push({ role: 'system', content: nodeConfig.systemPrompt });
    }

    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    messages.push(...history);

    if (message.text) {
      messages.push({ role: 'user', content: message.text });
    }

    const result = await provider.chat({ messages, maxTokens: nodeConfig.maxTokens });
    return { text: result.text };
  }
}
