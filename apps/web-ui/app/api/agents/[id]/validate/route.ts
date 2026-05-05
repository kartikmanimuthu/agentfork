import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { GraphValidationService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const { graph } = body;

    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return NextResponse.json(
        { error: 'Request body must include a graph object with nodes and edges arrays' },
        { status: 400 }
      );
    }

    const result = GraphValidationService.validate(graph);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
