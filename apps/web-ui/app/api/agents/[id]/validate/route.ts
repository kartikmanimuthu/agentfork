import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, graphValidationSchema, createLogger } from '@chatbot/shared';
import { GraphValidationService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:validate');

export async function POST(req: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = graphValidationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const { graph } = parsed.data;

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return NextResponse.json(
        { error: 'Request body must include a graph object with nodes and edges arrays' },
        { status: 400 }
      );
    }

    const result = GraphValidationService.validate(graph as any);
    logger.info({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length, valid: result.valid }, 'Graph validation completed');
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Graph validation failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
