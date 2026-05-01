import { getPrismaClient } from '@chatbot/shared';
import { streamChat } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('conversation-summary');

interface ConversationSummaryData {
  conversationId: string;
  fromMessageIndex: number;
}

export async function handleConversationSummary(data: unknown): Promise<void> {
  const { conversationId, fromMessageIndex } = data as ConversationSummaryData;
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

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const result = streamChat({
    messages: [
      {
        role: 'user',
        content: `Summarize this conversation concisely in 2-3 sentences:\n\n${conversationText}`,
      },
    ],
    system: 'You are a helpful assistant that creates concise conversation summaries.',
    maxTokens: 256,
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
