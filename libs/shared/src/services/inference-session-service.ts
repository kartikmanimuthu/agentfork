export interface SessionDb {
  inferenceSession: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CreateSessionInput {
  apiKeyId: string;
  tenantId: string;
  agentId: string;
  name?: string;
  metadata?: Record<string, unknown>;
  ttlHours?: number;
}

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
}

const DEFAULT_SESSION_TTL_HOURS = 24;

export class InferenceSessionService {
  constructor(private readonly db: SessionDb) {}

  async create(input: CreateSessionInput): Promise<unknown> {
    const ttlHours = input.ttlHours ?? DEFAULT_SESSION_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    return this.db.inferenceSession.create({
      data: {
        apiKeyId: input.apiKeyId,
        tenantId: input.tenantId,
        agentId: input.agentId,
        name: input.name ?? null,
        messages: [] as SessionMessage[],
        metadata: input.metadata ?? null,
        expiresAt,
      },
    });
  }

  async findById(id: string) {
    return this.db.inferenceSession.findFirst({
      where: { id, expiresAt: { gt: new Date() } },
    });
  }

  async findByApiKeyId(apiKeyId: string) {
    return this.db.inferenceSession.findMany({
      where: { apiKeyId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async appendMessage(id: string, message: SessionMessage): Promise<unknown> {
    const session = await this.findById(id) as { messages: SessionMessage[] } | null;
    if (!session) {
      throw new Error('Session not found or expired');
    }

    const messages = [...session.messages, message];
    return this.db.inferenceSession.update({
      where: { id },
      data: { messages: messages as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  }

  async delete(id: string): Promise<unknown> {
    return this.db.inferenceSession.delete({
      where: { id },
    });
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.db.inferenceSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }) as { count: number };

    return result.count;
  }
}
