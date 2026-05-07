import { NextRequest } from 'next/server';
import {
  getPrismaClient,
  createLogger,
  QuotaService,
  ResponseCacheService,
  InferenceSessionService,
  LlmProviderService,
  TenantConfigService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { validateInferenceApiKey } from './lib/auth';

const logger = createLogger('api:inference');

export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId, agentId, apiKey: keyLimits } = authResult.auth;

  try {
    const db = getPrismaClient();
    const quotaService = new QuotaService(apiKeyId, db);
    const cacheService = new ResponseCacheService(db);
    const sessionService = new InferenceSessionService(db);

    // Check quota
    const quotaCheck = await quotaService.checkQuota({
      dailyReqLimit: keyLimits.dailyReqLimit,
      dailyTokenLimit: keyLimits.dailyTokenLimit,
    });

    if (!quotaCheck.allowed) {
      return new Response(
        JSON.stringify({ error: { type: 'quota_exceeded', message: quotaCheck.reason } }),
        { status: 429 }
      );
    }

    const body = await req.json();
    const { messages, sessionId, systemPrompt, temperature, maxTokens, stream = true, noCache = false } = body;

    // Fetch agent
    const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
    if (!agent || agent.status !== 'active') {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'Agent not found or inactive' } }),
        { status: 404 }
      );
    }

    // Fetch published version
    const version = await db.agentVersion.findFirst({
      where: { agentId, status: 'published' },
      orderBy: { version: 'desc' },
    });

    if (!version) {
      return new Response(
        JSON.stringify({ error: { type: 'agent_not_found', message: 'No published version found for this agent' } }),
        { status: 404 }
      );
    }

    const config = (version.config as Record<string, unknown>) ?? {};
    const simpleConfig = config as { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number };

    const effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
    const effectiveModel = simpleConfig.model ?? undefined;
    const effectiveTemperature = temperature ?? simpleConfig.temperature ?? 0.7;
    const effectiveMaxTokens = maxTokens ?? simpleConfig.maxTokens ?? 4096;

    // Resolve LLM provider
    const llmProviderService = new LlmProviderService(tenantId);
    const llmConfig = await llmProviderService.getDefaultConfig()
      ?? await new TenantConfigService(tenantId).get<TenantLLMConfig>('llmConfig');
    const provider = createLLMProvider(llmConfig);

    // Session handling
    let sessionMessages = messages ?? [];
    if (sessionId) {
      const session = await sessionService.findById(sessionId) as { messages: Array<{ role: string; content: string }> } | null;
      if (session) {
        sessionMessages = [...session.messages, ...messages];
      }
    }

    const coreMessages = sessionMessages.map((m: { role: string; content?: string }) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content ?? '',
    }));

    // Cache check
    const cacheKey = cacheService.generateCacheKey({
      agentVersionId: version.id,
      systemPrompt: effectiveSystem,
      messages: coreMessages,
      model: effectiveModel ?? 'default',
      temperature: effectiveTemperature,
    });

    if (!noCache) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        await quotaService.incrementUsage(cached.usage.totalTokens);
        await db.apiKeyExecution.create({
          data: {
            apiKeyId,
            tenantId,
            agentId,
            agentVersionId: version.id,
            status: 'completed',
            input: { messages: sessionMessages },
            output: { text: cached.text },
            tokenUsage: cached.usage as unknown as Record<string, unknown>,
            cacheHit: true,
          },
        });

        const responseBody = {
          id: `cached-${Date.now()}`,
          content: cached.text,
          usage: cached.usage,
          cacheHit: true,
        };

        if (sessionId) {
          await sessionService.appendMessage(sessionId, {
            role: 'assistant',
            content: cached.text,
            timestamp: new Date().toISOString(),
          });
        }

        return new Response(JSON.stringify(responseBody), {
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(keyLimits.dailyReqLimit),
            'X-RateLimit-Remaining': String(quotaCheck.remainingRequests ?? 0),
            'X-TokenLimit-Limit': String(keyLimits.dailyTokenLimit),
            'X-TokenLimit-Remaining': String(quotaCheck.remainingTokens ?? 0),
          },
        });
      }
    }

    // Execute LLM
    const startedAt = new Date();
    const execution = await db.apiKeyExecution.create({
      data: {
        apiKeyId,
        tenantId,
        agentId,
        agentVersionId: version.id,
        status: 'running',
        input: { messages: sessionMessages },
        startedAt,
      },
    });

    if (stream) {
      // Streaming mode
      const result = streamChat({
        provider,
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxTokens,
        onFinish: async ({ text, usage }) => {
          const completedAt = new Date();
          const latencyMs = completedAt.getTime() - startedAt.getTime();
          const tokenUsage = {
            inputTokens: usage?.promptTokens ?? 0,
            outputTokens: usage?.completionTokens ?? 0,
            totalTokens: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
          };

          await quotaService.incrementUsage(tokenUsage.totalTokens);

          if (!noCache) {
            await cacheService.set(cacheKey, { text, usage: tokenUsage });
          }

          if (sessionId) {
            await sessionService.appendMessage(sessionId, {
              role: 'assistant',
              content: text,
              timestamp: completedAt.toISOString(),
            });
          }

          await db.apiKeyExecution.update({
            where: { id: execution.id },
            data: {
              status: 'completed',
              output: { text },
              tokenUsage: tokenUsage as unknown as Record<string, unknown>,
              cacheHit: false,
              latencyMs,
              completedAt,
            },
          });
        },
      });

      return result.toUIMessageStreamResponse({
        headers: {
          'x-execution-id': execution.id,
        },
      });
    } else {
      // Non-streaming mode - we need to collect the stream
      const result = streamChat({
        provider,
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxTokens,
      });

      // Collect stream into text
      const reader = result.toUIMessageStreamResponse().body?.getReader();
      let text = '';
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      }

      // For non-streaming, we'll return a simple response
      // Note: Full implementation would parse the stream properly
      const completedAt = new Date();
      const latencyMs = completedAt.getTime() - startedAt.getTime();

      await db.apiKeyExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output: { text },
          cacheHit: false,
          latencyMs,
          completedAt,
        },
      });

      if (sessionId) {
        await sessionService.appendMessage(sessionId, {
          role: 'assistant',
          content: text,
          timestamp: completedAt.toISOString(),
        });
      }

      return new Response(JSON.stringify({
        id: execution.id,
        content: text,
        cacheHit: false,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Inference execution error');
    return new Response(
      JSON.stringify({ error: { type: 'llm_error', message: 'Internal server error' } }),
      { status: 500 }
    );
  }
}
