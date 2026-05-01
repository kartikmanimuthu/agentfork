import { NextRequest } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, MessageService, ConversationService } from '@chatbot/shared';
import { streamChat } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

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

    const messages = await messageService.findByConversationId(conversation.id);
    const coreMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const result = streamChat({
      messages: coreMessages,
      model,
      onFinish: async ({ text, usage }) => {
        await messageService.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: text,
          tokenCount: usage.completionTokens,
        });
        await conversationService.update(conversation.id, {
          messageCount: messages.length + 2,
        });
      },
    });

    return result.toDataStreamResponse({
      headers: { 'x-conversation-id': conversation.id },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
