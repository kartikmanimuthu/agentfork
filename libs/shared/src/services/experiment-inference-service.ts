import { createLogger } from '../logging/logger';
import { InferenceSessionService, type SessionDb } from './inference-session-service';
import { streamChat, createLLMProvider } from '@chatbot/ai';
import type { LLMProvider } from '@chatbot/ai';

const logger = createLogger('experiment-inference-service');

export interface ExperimentInferenceDb extends SessionDb {
  agent: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; type: string } | null> };
  agentVersion: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; agentId: string; config: unknown } | null> };
  apiKey: { findFirst(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<{ id: string } | null> };
}

export interface RunInferenceInput {
  tenantId: string;
  agentVersionId: string;
  input: unknown;
  provider: LLMProvider;
  userId: string;
}

interface SimpleAgentConfig {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export class ExperimentInferenceService {
  private readonly sessionService: InferenceSessionService;

  constructor(private readonly db: ExperimentInferenceDb) {
    this.sessionService = new InferenceSessionService(db);
  }

  async run(input: RunInferenceInput): Promise<{ outputText: string; outputJson: unknown; latencyMs: number; tokenUsage: unknown; inferenceSessionId: string }> {
    const startedAt = Date.now();
    const version = (await this.db.agentVersion.findFirst({ where: { id: input.agentVersionId } })) as
      | { id: string; agentId: string; config: unknown }
      | null;
    if (!version) throw new Error('Agent version not found');

    const agent = await this.db.agent.findFirst({ where: { id: version.agentId, tenantId: input.tenantId } });
    if (!agent) throw new Error('Agent not found');

    const apiKey = await this.db.apiKey.findFirst({ where: { tenantId: input.tenantId, agentId: agent.id }, orderBy: { createdAt: 'asc' } });
    if (!apiKey) throw new Error('No API key found for agent');

    const userMessage = this.extractUserText(input.input);

    if (agent.type === 'simple') {
      const config = version.config as SimpleAgentConfig;
      const session = await this.sessionService.create({
        apiKeyId: apiKey.id,
        tenantId: input.tenantId,
        agentId: agent.id,
        agentVersionId: version.id,
        name: `experiment-${input.agentVersionId}`,
        channel: 'EXPERIMENT',
      });
      await this.sessionService.appendMessage(session.id, { role: 'user', content: userMessage });

      const result = streamChat({
        provider: input.provider,
        model: config.model ?? undefined,
        system: config.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 4096,
      });

      const text = await result.text;
      const usage = await result.usage;
      await this.sessionService.appendMessage(session.id, { role: 'assistant', content: text });
      await this.sessionService.endSession(session.id, 'closed');

      const latencyMs = Date.now() - startedAt;
      logger.info({ tenantId: input.tenantId, agentVersionId: version.id, sessionId: session.id, latencyMs }, 'Experiment inference complete');
      return { outputText: text, outputJson: { text }, latencyMs, tokenUsage: usage, inferenceSessionId: session.id };
    }

    // Graph agents: fall back to simple single-turn chat using the version config if possible.
    const config = version.config as SimpleAgentConfig;
    const result = streamChat({
      provider: input.provider,
      model: config.model ?? undefined,
      system: config.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.maxTokens ?? 4096,
    });
    const text = await result.text;
    const usage = await result.usage;
    const latencyMs = Date.now() - startedAt;
    return { outputText: text, outputJson: { text }, latencyMs, tokenUsage: usage, inferenceSessionId: '' };
  }

  private extractUserText(input: unknown): string {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (typeof obj.content === 'string') return obj.content;
      if (typeof obj.q === 'string') return obj.q;
      if (Array.isArray(obj.messages)) {
        const lastUser = [...obj.messages].reverse().find((m: any) => m.role === 'user');
        if (lastUser?.content) return String(lastUser.content);
      }
    }
    return JSON.stringify(input);
  }
}
