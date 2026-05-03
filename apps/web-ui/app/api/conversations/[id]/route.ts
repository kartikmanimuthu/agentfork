import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSessionTenantId, authorize, AuditService, ConversationService, updateConversationSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new ConversationService(tenantId);
    const conversation = await service.findById(id);

    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await parseJson(req, updateConversationSchema);
    const service = new ConversationService(tenantId);
    const conversation = await service.update(id, body);

    const session = await getServerSession(authOptions);
    AuditService.logUserAction({
      eventType: 'chat.conversation.updated',
      action: 'Updated Conversation',
      resourceType: 'conversation',
      resourceId: id,
      resourceName: conversation.title || id,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'low',
      details: `Updated conversation ${id}`,
      apiRoute: 'PUT /api/conversations/[id]',
      httpMethod: 'PUT',
      metadata: { tenantId, conversationId: id, ...body },
      tenantId,
    }).catch(() => {});

    return NextResponse.json(conversation);
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const service = new ConversationService(tenantId);
    await service.delete(id);

    const session = await getServerSession(authOptions);
    AuditService.logUserAction({
      eventType: 'chat.conversation.deleted',
      action: 'Deleted Conversation',
      resourceType: 'conversation',
      resourceId: id,
      resourceName: id,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Deleted conversation ${id}`,
      apiRoute: 'DELETE /api/conversations/[id]',
      httpMethod: 'DELETE',
      metadata: { tenantId, conversationId: id },
      tenantId,
    }).catch(() => {});

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
