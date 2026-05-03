import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, MessageService, messageQuerySchema, parseSearchParams, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Chat', authOptions);
    if (authError) return authError;

    const { conversationId, limit } = parseSearchParams(new URL(req.url).searchParams, messageQuerySchema);
    const service = new MessageService(tenantId);
    const messages = await service.findByConversationId(conversationId, limit);

    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
