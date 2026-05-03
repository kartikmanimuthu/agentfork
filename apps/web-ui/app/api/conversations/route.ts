import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSessionTenantId, getSessionUserId, authorize, AuditService, ConversationService, paginationQuerySchema, createConversationSchema, parseSearchParams, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { limit, offset } = parseSearchParams(new URL(req.url).searchParams, paginationQuerySchema);

    const service = new ConversationService(tenantId);
    const result = await service.findByUserId(userId, { limit, offset });

    return NextResponse.json(result);
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

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Conversations', authOptions);
    if (authError) return authError;

    const { title, model } = await parseJson(req, createConversationSchema);
    const service = new ConversationService(tenantId);
    const conversation = await service.create({ userId, title, model });

    const session = await getServerSession(authOptions);
    AuditService.logUserAction({
      eventType: 'chat.conversation.created',
      action: 'Created Conversation',
      resourceType: 'conversation',
      resourceId: conversation.id,
      resourceName: conversation.title || 'New Conversation',
      user: session?.user?.email || session?.user?.id || userId,
      userType: 'user',
      status: 'success',
      severity: 'low',
      details: `Created conversation "${conversation.title || 'New Conversation'}"`,
      apiRoute: 'POST /api/conversations',
      httpMethod: 'POST',
      metadata: { tenantId, conversationId: conversation.id, title: conversation.title },
      tenantId,
    }).catch(() => {});

    return NextResponse.json(conversation, { status: 201 });
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
