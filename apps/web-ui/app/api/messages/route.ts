import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, MessageService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Chat', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const limit = parseInt(searchParams.get('limit') ?? '50', 10);
    const service = new MessageService(tenantId);
    const messages = await service.findByConversationId(conversationId, limit);

    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
