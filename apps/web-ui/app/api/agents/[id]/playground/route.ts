import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
  LlmProviderService,
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
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'AgentExecution', authOptions);
    if (authError) return authError;

    const { id } = await params;

    const db = getPrismaClient();

    const body = await req.json();
    const { messages, systemPrompt, model, temperature, agentVersionId } = body;
    const { alias } = body;

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
      const provider = createLLMProvider(llmConfig);

      const coreMessages = (messages as Array<{ role: string; content?: string; parts?: Array<{ type: string; text: string }> }>).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? m.parts?.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? '',
      }));

      const userQuery = coreMessages.filter((m) => m.role === 'user').pop()?.content ?? '';
      const kbContext = await buildKbContext(id, tenantId, userQuery, db);

      let effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
      if (kbContext) {
        effectiveSystem = `${effectiveSystem}\n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n${kbContext}`;
      }

      const result = streamChat({
        provider,
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: simpleConfig.maxTokens ?? 4096,
        onFinish: async ({ text, usage }) => {
          const completedAt = new Date();
          await db.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: 'completed',
              output: { text, usage },
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
    }

    // Graph agent execution (basic fallback for v1)
    if (agent.type === 'graph') {
      const graphConfig = resolvedConfig as { nodes?: Array<{ id: string; type: string; label: string }>; edges?: Array<{ id: string; source: string; target: string }> };
      const nodes = graphConfig.nodes ?? [];
      const edges = graphConfig.edges ?? [];

      const traceSteps = nodes.map((node) => ({
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: node.label,
        status: 'completed',
        timestamp: new Date().toISOString(),
      }));

      const text = `[Graph agent execution simulated]\\n\\nNodes executed: ${nodes.length}\\nEdges traversed: ${edges.length}\\n\\nGraph execution is not yet fully implemented in the playground. Use simple agents for live testing, or export the graph to run it in a LangGraph runtime.`;

      await db.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output: { text, trace: { steps: traceSteps, nodeCount: nodes.length, edgeCount: edges.length } },
          completedAt: new Date(),
        },
      });

      return new Response(
        JSON.stringify({
          role: 'assistant',
          content: text,
          id: execution.id,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'x-execution-id': execution.id,
          },
        }
      );
    }

    return new Response(JSON.stringify({ error: 'Unsupported agent type' }), { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error }, 'Playground execution error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
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
        contexts.push(`--- From ${kb.name} ---\n${results.map((r: any) => r.content).join('\n\n')}`);
      }
    } catch {
      // Skip KBs that fail retrieval
    }
  }

  return contexts.join('\n\n');
}
