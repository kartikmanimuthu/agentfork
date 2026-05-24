import { createLogger } from '../logging/logger';

const logger = createLogger('csat-service');

export interface CsatDb {
  csatResponse: {
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    findUnique(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
  };
}

export interface SubmitCsatInput {
  sessionId: string;
  sdkWidgetId: string;
  rating: number;
  comment?: string;
}

export class CsatService {
  constructor(private readonly db: CsatDb) {}

  async submit(input: SubmitCsatInput): Promise<unknown> {
    logger.info({ sessionId: input.sessionId, rating: input.rating }, 'Submitting CSAT response');

    return this.db.csatResponse.upsert({
      where: { sessionId: input.sessionId },
      create: { sessionId: input.sessionId, sdkWidgetId: input.sdkWidgetId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment },
    });
  }

  async findBySession(sessionId: string): Promise<unknown | null> {
    return this.db.csatResponse.findUnique({ where: { sessionId } });
  }

  async listByWidget(sdkWidgetId: string): Promise<unknown[]> {
    return this.db.csatResponse.findMany({ where: { sdkWidgetId } });
  }
}
