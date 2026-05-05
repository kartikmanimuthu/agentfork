import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();
    const versionService = new AgentVersionService(db as any);

    // Find the latest draft version for this agent and publish it
    const versions = await versionService.findByAgentId(id);
    const latestDraft = (versions as any[]).find((v: any) => v.status === 'draft');

    if (!latestDraft) {
      return NextResponse.json(
        { error: 'No draft version found to publish' },
        { status: 422 }
      );
    }

    const published = await versionService.publish(latestDraft.id);
    return NextResponse.json(published);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
