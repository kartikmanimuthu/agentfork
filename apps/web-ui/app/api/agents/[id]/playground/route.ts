import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
  LlmProviderService,
  playgroundRequestSchema,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:playground');

async function resolveProviderForModel(
  tenantId: string,
  modelId: string | undefined
): Promise<TenantLLMConfig | null> {
  if (!modelId) return null;
  const llmProviderService = new LlmProviderService(tenantId);
  const providers = await llmProviderService.list();
  for (const provider of providers) {
    const discovered = (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
    if (discovered.some((m) => m.id === modelId)) {
      return llmProviderService.getConfigById(provider.id);
    }
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  let agentId: string | undefined;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'AgentExecution', authOptions);
    if (authError) return authError;

    const { id } = await params;
    agentId = id;

    logger.info({ requestId, agentId, tenantId, userId }, 'Playground execution started');

    const db = getPrismaClient();

    const body = await req.json();
    const parsed = playgroundRequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 }
      );
    }
    const { messages, systemPrompt, model, temperature, maxTokens, agentVersionId } = parsed.data;
    const { alias } = parsed.data;

    // Fetch agent
    const agent = await db.agent.findFirst({ where: { id, tenantId } });
    if (!agent) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });
    }

    // Resolve version
    let resolvedConfig: Record<string, unknown> = {};
    let resolvedVersionId: string | null = agentVersionId ?? null;

    if (resolvedVersionId) {
      const version = await db.agentVersion.findFirst({ where: { id: resolvedVersionId, agentId: id } });
      if (version) {
        resolvedConfig = (version.config as Record<string, unknown>) ?? {};
      }
    } else if (alias) {
      const aliasService = new (await import('@chatbot/agent-studio')).AgentAliasService(tenantId, db as any);
      try {
        const resolved = await aliasService.resolveAlias(id, alias);
        resolvedConfig = resolved.config;
        resolvedVersionId = resolved.versionId;
      } catch {
        // fall through to agent config
      }
    } else {
      // Try default alias
      const defaultAlias = await db.agentAlias.findFirst({
        where: { agentId: id, isDefault: true },
        include: { version: true },
      });
      if (defaultAlias) {
        resolvedConfig = (defaultAlias.version.config as Record<string, unknown>) ?? {};
        resolvedVersionId = defaultAlias.versionId;
      }
    }

    if (Object.keys(resolvedConfig).length === 0) {
      resolvedConfig = (agent.config as Record<string, unknown>) ?? {};
    }

    // Fallback: if no version resolved, use the latest version for this agent
    if (!resolvedVersionId) {
      const latestVersion = await db.agentVersion.findFirst({
        where: { agentId: id },
        orderBy: { version: 'desc' },
      });
      if (latestVersion) {
        resolvedVersionId = latestVersion.id;
      }
    }

    // If still no version, we cannot create an execution (schema requires agentVersionId)
    if (!resolvedVersionId) {
      return new Response(JSON.stringify({ error: 'Agent has no versions. Please publish a version first.' }), { status: 400 });
    }

    const startedAt = new Date();
    const execution = await db.agentExecution.create({
      data: {
        agentId: id,
        agentVersionId: resolvedVersionId as string,
        tenantId,
        userId,
        status: 'running',
        input: { messages, overrides: { systemPrompt, model, temperature } },
        startedAt,
      },
    });

    logger.info({ requestId, executionId: execution.id, agentId: id, agentType: agent.type }, 'Execution record created');

    // Simple agent execution
    if (agent.type === 'simple') {
      const simpleConfig = resolvedConfig as { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number; tools?: string[] };
      const effectiveModel = model ?? simpleConfig.model ?? undefined;
      const effectiveTemperature = temperature ?? simpleConfig.temperature ?? 0.7;

      // Resolve LLM provider by model, then fall back to default
      const llmProviderService = new LlmProviderService(tenantId);
      const llmConfig = await resolveProviderForModel(tenantId, effectiveModel)
        ?? await llmProviderService.getDefaultConfig()
        ?? await new TenantConfigService(tenantId).get<TenantLLMConfig>('llmConfig');

      logger.info({ requestId, provider: llmConfig?.provider, chatModel: llmConfig?.chatModel, region: llmConfig?.region, hasAccessKey: !!llmConfig?.accessKeyId }, 'Resolved LLM config');

      const provider = createLLMProvider(llmConfig);
      logger.info({ requestId, providerName: provider.name, providerChatModel: provider.chatModel }, 'LLM provider instantiated');

      await provider.validate();
      logger.info({ requestId }, 'Provider validation passed');

      const coreMessages = (messages as Array<{ role: string; content?: string; parts?: Array<{ type: string; text: string }> }>).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? m.parts?.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? '',
      }));

      const userQuery = coreMessages.filter((m) => m.role === 'user').pop()?.content ?? '';
      const kbContext = await buildKbContext(id, tenantId, userQuery, db);

      // Discover MCP tools attached to this agent
      const { buildMcpToolsForAgent } = await import('@chatbot/agent-studio/server');
      const { tools: mcpTools, cleanup: mcpCleanup } = await buildMcpToolsForAgent(id, tenantId, db);
      const hasMcpTools = Object.keys(mcpTools).length > 0;

      logger.info({ requestId, mcpToolCount: Object.keys(mcpTools).length }, 'MCP tools discovered');

      let effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
      if (kbContext) {
        effectiveSystem = `${effectiveSystem}\n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n${kbContext}`;
      }

      logger.info({ requestId, executionId: execution.id, messageCount: coreMessages.length, hasKbContext: !!kbContext, hasMcpTools }, 'Starting stream chat');

      const startTime = Date.now();
      let ttftMs: number | undefined;
      let capturedUsage: { inputTokens?: number; outputTokens?: number } | undefined;

      const result = streamChat({
        provider,
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: maxTokens ?? simpleConfig.maxTokens ?? 4096,
        ...(hasMcpTools ? { tools: mcpTools, maxSteps: 5 } : {}),
        onFinish: async ({ text, usage }) => {
          capturedUsage = usage;
          await mcpCleanup();
          const completedAt = new Date();
          await db.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: 'completed',
              output: { text, usage },
              completedAt,
            },
          });
          logger.info({ requestId, executionId: execution.id, usage }, 'Execution completed');
        },
      });

      const originalResponse = result.toUIMessageStreamResponse();
      const originalBody = originalResponse.body;
      if (!originalBody) {
        return originalResponse;
      }

      const encoder = new TextEncoder();

      const enhancedStream = new ReadableStream({
        async start(controller) {
          // Emit execution_start so the client console can record timing
          controller.enqueue(
            encoder.encode(
              `event: execution_start\ndata: ${JSON.stringify({
                executionId: execution.id,
                model: effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
                temperature: effectiveTemperature,
                maxTokens: maxTokens ?? simpleConfig.maxTokens ?? 4096,
                timestamp: startTime,
              })}\n\n`
            )
          );

          const reader = originalBody.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              // Record time-to-first-token on the first chunk
              if (ttftMs === undefined) {
                ttftMs = Date.now() - startTime;
              }

              controller.enqueue(value);
            }

            const durationMs = Date.now() - startTime;
            controller.enqueue(
              encoder.encode(
                `event: execution_end\ndata: ${JSON.stringify({
                  usage: {
                    inputTokens: capturedUsage?.inputTokens ?? 0,
                    outputTokens: capturedUsage?.outputTokens ?? 0,
                    thinkingTokens: 0,
                  },
                  durationMs,
                  ttftMs: ttftMs ?? durationMs,
                  model: effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
                })}\n\n`
              )
            );
          } catch (err) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  code: 'STREAM_ERROR',
                  message: err instanceof Error ? err.message : String(err),
                  timestamp: Date.now(),
                })}\n\n`
              )
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(enhancedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'x-execution-id': execution.id,
          'x-model-id': effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
          'x-request-timestamp': String(startTime),
        },
      });
    }

    // Graph agent execution with real GraphExecutor
    if (agent.type === 'graph') {
      const { GraphExecutor, LlmNodeExecutor, RouterNodeExecutor, ToolNodeExecutor, StateSchemaNodeExecutor, KnowledgeBaseNodeExecutor, McpServerNodeExecutor, InputNodeExecutor, OutputNodeExecutor, MemoryNodeExecutor, CodeNodeExecutor, ConditionNodeExecutor, HttpNodeExecutor, HumanNodeExecutor, ParallelNodeExecutor, SubAgentNodeExecutor, DelayNodeExecutor } = await import('@chatbot/agent-studio/server');

      const graphDef = resolvedConfig as { nodes?: any[]; edges?: any[] };
      const nodes = graphDef.nodes ?? [];
      const edges = graphDef.edges ?? [];

      if (nodes.length === 0) {
        return new Response(JSON.stringify({ error: 'Graph has no nodes' }), { status: 400 });
      }

      const coreMessages = (messages as Array<{ role: string; content?: string; parts?: Array<{ type: string; text: string }> }>).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? m.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') ?? '',
      }));

      const llmProviderService = new LlmProviderService(tenantId);

      const services = {
        llmProvider: async (_providerId?: string, modelId?: string) => {
          const llmConfig = await resolveProviderForModel(tenantId, modelId)
            ?? await llmProviderService.getDefaultConfig()
            ?? await new TenantConfigService(tenantId).get('llmConfig');
          const provider = createLLMProvider(llmConfig);
          await provider.validate();
          return provider;
        },
        prisma: db,
      };

      const executor = new GraphExecutor(services);
      executor.register(new LlmNodeExecutor());
      executor.register(new RouterNodeExecutor());
      executor.register(new ToolNodeExecutor());
      executor.register(new StateSchemaNodeExecutor());
      executor.register(new KnowledgeBaseNodeExecutor());
      executor.register(new McpServerNodeExecutor());
      executor.register(new InputNodeExecutor());
      executor.register(new OutputNodeExecutor());
      executor.register(new MemoryNodeExecutor());
      executor.register(new CodeNodeExecutor());
      executor.register(new ConditionNodeExecutor());
      executor.register(new HttpNodeExecutor());
      executor.register(new HumanNodeExecutor());
      executor.register(new ParallelNodeExecutor());
      executor.register(new SubAgentNodeExecutor());
      executor.register(new DelayNodeExecutor());

      let fullText = '';
      const graphStartTime = Date.now();
      let graphTtftMs: number | undefined;

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const sendEvent = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          sendEvent('execution_start', {
            executionId: execution.id,
            model: 'graph',
            temperature: 0,
            maxTokens: 0,
            timestamp: graphStartTime,
          });

          try {
            await executor.execute(
              { nodes, edges },
              { messages: coreMessages },
              { executionId: execution.id, agentId: id, tenantId, userId },
              {
                onEvent: (event) => {
                  if (event.type === 'text_delta' && graphTtftMs === undefined) {
                    graphTtftMs = Date.now() - graphStartTime;
                  }
                  sendEvent(event.type, event);
                  if (event.type === 'text_delta') {
                    fullText += event.delta;
                  }
                },
              }
            );

            const durationMs = Date.now() - graphStartTime;
            sendEvent('execution_end', {
              usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
              durationMs,
              ttftMs: graphTtftMs ?? durationMs,
              model: 'graph',
            });

            await db.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: 'completed',
                output: { text: fullText },
                completedAt: new Date(),
              },
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const durationMs = Date.now() - graphStartTime;
            sendEvent('error', { code: 'EXECUTION_ERROR', message: errorMessage, timestamp: Date.now() });
            sendEvent('execution_end', {
              usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
              durationMs,
              ttftMs: graphTtftMs ?? durationMs,
              model: 'graph',
              error: errorMessage,
            });
            await db.agentExecution.update({
              where: { id: execution.id },
              data: { status: 'failed', output: { error: errorMessage }, completedAt: new Date() },
            });
            logger.error({ executionId: execution.id, error: errorMessage }, 'Graph execution failed');
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'x-execution-id': execution.id,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported agent type' }), { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { err, errorMessage: err.message, errorStack: err.stack, requestId, agentId },
      'Playground execution error'
    );
    return new Response(JSON.stringify({ error: 'Internal server error', message: err.message }), { status: 500 });
  }
}

async function buildKbContext(
  agentId: string,
  tenantId: string,
  query: string,
  db: any
): Promise<string> {
  const attachments = await db.agentKnowledgeBase.findMany({
    where: { agentId },
    include: { knowledgeBase: true },
  });

  if (!attachments || attachments.length === 0) return '';

  const { RetrievalService } = await import('@chatbot/knowledge-base');
  const retrieval = new RetrievalService(tenantId);

  const contexts: string[] = [];
  for (const att of attachments) {
    const kb = att.knowledgeBase;
    if (kb.status !== 'active') continue;

    try {
      const results = await retrieval.query(query, {
        knowledgeBaseId: kb.id,
        topK: 5,
      });

      if (results.length > 0) {
        contexts.push(`--- From ${kb.name} ---\\n${results.map((r: any) => r.content).join('\\n\\n')}`);
      }
    } catch {
      // Skip KBs that fail retrieval
    }
  }

  return contexts.join('\\n\\n');
}
