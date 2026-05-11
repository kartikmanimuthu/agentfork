import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  AuditService,
  MessageService,
  ConversationService,
  createLogger,
  TenantConfigService,
  LlmProviderService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:chat');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Chat', authOptions);
    if (authError) return authError;

    const { conversationId, content, model } = await req.json();

    const conversationService = new ConversationService(tenantId);
    const messageService = new MessageService(tenantId);

    let conversation;
    if (conversationId) {
      conversation = await conversationService.findById(conversationId);
      if (!conversation) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
      }
    } else {
      conversation = await conversationService.create({
        userId,
        title: content.slice(0, 100),
        model,
      });
    }

    await messageService.create({
      conversationId: conversation.id,
      role: 'user',
      content,
    });

    const session = await getServerSession(authOptions);
    AuditService.logUserAction({
      eventType: 'chat.message.sent',
      action: 'Sent Message',
      resourceType: 'conversation',
      resourceId: conversation.id,
      resourceName: conversation.title || conversation.id,
      user: session?.user?.email || session?.user?.id || userId,
      userType: 'user',
      status: 'success',
      severity: 'low',
      details: `User sent a message in conversation ${conversation.id}`,
      apiRoute: 'POST /api/chat',
      httpMethod: 'POST',
      metadata: { conversationId: conversation.id, tenantId },
      tenantId,
    }).catch(() => {});

    const messages = await messageService.findByConversationId(conversation.id);
    const coreMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Resolve tenant LLM config: new table first, then legacy tenant_configs
    const llmProviderService = new LlmProviderService(tenantId);
    const llmConfig = await llmProviderService.getDefaultConfig()
      ?? await new TenantConfigService(tenantId).get<TenantLLMConfig>('llmConfig');
    logger.info({ tenantId, provider: llmConfig?.provider, model: llmConfig?.chatModel, baseUrl: llmConfig?.baseUrl }, 'Resolved LLM config for chat');
    const provider = createLLMProvider(llmConfig);

    const result = streamChat({
      provider,
      messages: coreMessages,
      model,
      onFinish: async ({ text, usage }) => {
        await messageService.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: text,
          tokenCount: usage.outputTokens ?? 0,
        });
        await conversationService.update(conversation.id, {
          messageCount: messages.length + 2,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      headers: { 'x-conversation-id': conversation.id },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error }, 'Chat error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
