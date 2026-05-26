import { createLogger } from '../logging/logger';

const logger = createLogger('feedback-service');

export interface FeedbackDb {
  messageFeedback: {
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
  };
}

export interface SubmitFeedbackInput {
  messageId: string;
  sessionId: string;
  rating: 'up' | 'down';
  comment?: string;
}

export class FeedbackService {
  constructor(private readonly db: FeedbackDb) {}

  async submit(input: SubmitFeedbackInput): Promise<unknown> {
    logger.info({ messageId: input.messageId, sessionId: input.sessionId, rating: input.rating }, 'Submitting message feedback');

    return this.db.messageFeedback.upsert({
      where: { messageId_sessionId: { messageId: input.messageId, sessionId: input.sessionId } },
      create: { messageId: input.messageId, sessionId: input.sessionId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment },
    });
  }

  async listBySession(sessionId: string): Promise<unknown[]> {
    return this.db.messageFeedback.findMany({ where: { sessionId } });
  }
}
