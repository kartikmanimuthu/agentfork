import { getPrismaClient } from '@chatbot/shared';
import { generateEmbedding } from '@chatbot/ai';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('message-embedding');

interface MessageEmbeddingData {
  messageId: string;
}

export async function handleMessageEmbedding(data: unknown): Promise<void> {
  const { messageId } = data as MessageEmbeddingData;
  log.info('Generating embedding', { messageId });

  const prisma = getPrismaClient();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, content: true },
  });

  if (!message) {
    log.warn('Message not found, skipping', { messageId });
    return;
  }

  const embedding = await generateEmbedding(message.content);
  const vectorStr = `[${embedding.join(',')}]`;

  await prisma.$executeRawUnsafe(
    `UPDATE messages SET embedding = $1::vector WHERE id = $2`,
    vectorStr,
    messageId,
  );

  log.info('Embedding stored', { messageId });
}
