import { getPrismaClient, conversationSummaryJobSchema, TenantConfigService } from '@chatbot/shared/workers';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('conversation-summary');

export async function handleConversationSummary(data: unknown): Promise<void> {
  const { conversationId, fromMessageIndex } = conversationSummaryJobSchema.parse(data);
  log.info('Generating summary', { conversationId, fromMessageIndex });

  const prisma = getPrismaClient();
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    skip: fromMessageIndex,
    select: { role: true, content: true },
  });

  if (messages.length === 0) {
    log.warn('No messages to summarize', { conversationId });
    return;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true },
  });
  if (!conversation) {
    log.warn('Conversation not found', { conversationId });
    return;
  }

  const configService = new TenantConfigService(conversation.tenantId);
  const llmConfig = await configService.get<TenantLLMConfig>('llmConfig');
  const provider = createLLMProvider(llmConfig);

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const result = streamChat({
    provider,
    messages: [
      {
        role: 'user',
        content: `Summarize this conversation concisely in 2-3 sentences:\n\n${conversationText}`,
      },
    ],
    system: 'You are a helpful assistant that creates concise conversation summaries.',
    maxOutputTokens: 256,
  });

  let summary = '';
  for await (const chunk of result.textStream) {
    summary += chunk;
  }

  await prisma.conversationSummary.create({
    data: {
      conversationId,
      summary,
      messageRange: { from: fromMessageIndex, to: fromMessageIndex + messages.length },
    },
  });

  log.info('Summary stored', { conversationId });
}
