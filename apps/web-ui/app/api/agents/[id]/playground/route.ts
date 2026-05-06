import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:playground');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'AgentExecution', authOptions);
    if (authError) return authError;

    const { id } = await params;

    const configService = new TenantConfigService(tenantId);
    const llmConfig = await configService.get<TenantLLMConfig>('llmConfig');
    const provider = createLLMProvider(llmConfig);

    const db = getPrismaClient();

    const body = await req.json();
    const { messages, systemPrompt, model, temperature, agentVersionId } = body;

    // Fetch agent
    const agent = await db.agent.findFirst({ where: { id, tenantId } });
    if (!agent) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });
    }

    // Determine config: use version override if provided, else agent config
    let config: Record<string, unknown> = {};
    if (agentVersionId) {
      const version = await db.agentVersion.findFirst({ where: { id: agentVersionId, agentId: id } });
      if (version) {
        config = (version.config as Record<string, unknown>) ?? {};
      }
    } else {
      config = (agent.config as Record<string, unknown>) ?? {};
    }

    const startedAt = new Date();
    const execution = await db.agentExecution.create({
      data: {
        agentId: id,
        agentVersionId: agentVersionId ?? null,
        tenantId,
        userId,
        status: 'running',
        input: { messages, overrides: { systemPrompt, model, temperature } },
        startedAt,
      },
    });

    // Simple agent execution
    if (agent.type === 'simple') {
      const simpleConfig = config as { model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number; tools?: string[] };
      const effectiveSystem = systemPrompt ?? simpleConfig.systemPrompt ?? 'You are a helpful assistant.';
      const effectiveModel = model ?? simpleConfig.model ?? undefined;
      const effectiveTemperature = temperature ?? simpleConfig.temperature ?? 0.7;

      const coreMessages = (messages as Array<{ role: string; content?: string; parts?: Array<{ type: string; text: string }> }>).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? m.parts?.filter((p) => p.type === 'text').map((p) => p.text).join('') ?? '',
      }));

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
      const graphConfig = config as { nodes?: Array<{ id: string; type: string; label: string }>; edges?: Array<{ id: string; source: string; target: string }> };
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
