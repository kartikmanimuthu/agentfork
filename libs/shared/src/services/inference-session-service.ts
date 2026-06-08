/**
 * InferenceSessionService — canonical session lifecycle for the unified Inference API.
 *
 * Backed by the InferenceSession + InferenceSessionMessage Prisma models.
 * Session state machine: active → ended (closed | idle_timeout | error)
 * Default idle timeout: 30 minutes, refreshed on every appendMessage.
 */

export const DEFAULT_IDLE_MINUTES = 30;

export type SessionEndReason = 'closed' | 'idle_timeout' | 'error';

export interface SessionMessageInput {
  role: string;
  content: string;
  tokenCount?: number;
  attachments?: import('@chatbot/ai').MessageAttachment[];
  /** Rich message parts (MessagePart[]) — persisted as JSONB; content kept for embeddings/back-compat. */
  parts?: unknown[];
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  attachments: unknown;
  tokenCount: number | null;
  createdAt: Date;
}

export interface InferenceSessionRecord {
  id: string;
  apiKeyId: string;
  tenantId: string;
  agentId: string;
  agentVersionId: string | null;
  name: string | null;
  channel: string;
  channelMetadata: unknown;
  workflowState: unknown;
  status: string;
  idleExpiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: SessionMessageRecord[];
}

export interface CreateSessionInput {
  apiKeyId: string;
  tenantId: string;
  agentId: string;
  agentVersionId?: string;
  name?: string;
  channel?: string;
  channelMetadata?: Record<string, unknown> | null;
  /** Override default idle timeout in minutes. */
  idleMinutes?: number;
}

export interface FindStaleSessionsArgs {
  /** Sessions whose idleExpiresAt is before this date are considered stale. Defaults to now. */
  idleBefore?: Date;
  /** Maximum rows to return per call. Defaults to 100. */
  limit?: number;
}

/**
 * Minimal Prisma surface this service depends on.
 * Concrete usage: pass `getPrismaClient()` — the real Prisma client matches this shape.
 */
export interface SessionDb {
  inferenceSession: {
    create(args: { data: Record<string, unknown> }): Promise<InferenceSessionRecord>;
    findFirst(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<InferenceSessionRecord | null>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
      take?: number;
      include?: Record<string, unknown>;
    }): Promise<InferenceSessionRecord[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<InferenceSessionRecord>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    delete(args: { where: Record<string, unknown> }): Promise<InferenceSessionRecord>;
  };
  inferenceSessionMessage: {
    create(args: { data: Record<string, unknown> }): Promise<SessionMessageRecord>;
  };
}

export class InferenceSessionService {
  constructor(private readonly db: SessionDb) {}

  /** Create a new session in `active` status. idleExpiresAt = now + DEFAULT_IDLE_MINUTES. */
  async create(input: CreateSessionInput): Promise<InferenceSessionRecord> {
    const minutes = input.idleMinutes ?? DEFAULT_IDLE_MINUTES;
    const idleExpiresAt = new Date(Date.now() + minutes * 60 * 1000);

    return this.db.inferenceSession.create({
      data: {
        apiKeyId: input.apiKeyId,
        tenantId: input.tenantId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId ?? null,
        name: input.name ?? null,
        channel: input.channel ?? 'API',
        channelMetadata: (input.channelMetadata ?? null) as Record<string, unknown> | null,
        status: 'active',
        idleExpiresAt,
      },
    });
  }

  /** Find an active, non-idle-expired session by id, with its messages eagerly loaded. */
  async findActiveById(id: string): Promise<InferenceSessionRecord | null> {
    return this.db.inferenceSession.findFirst({
      where: {
        id,
        status: 'active',
        idleExpiresAt: { gt: new Date() },
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /**
   * Back-compat alias for callers that still use `findById` to mean "load the active session
   * if it's still alive". Returns null if ended OR idle-expired.
   */
  async findById(id: string): Promise<InferenceSessionRecord | null> {
    return this.findActiveById(id);
  }

  /** List active, non-idle-expired sessions for an API key (used by the API consumer SDK). */
  async findByApiKeyId(apiKeyId: string): Promise<InferenceSessionRecord[]> {
    return this.db.inferenceSession.findMany({
      where: {
        apiKeyId,
        status: 'active',
        idleExpiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Append a message row to the session and bump idleExpiresAt by DEFAULT_IDLE_MINUTES.
   * Throws if the session is not active or has idle-expired.
   */
  async appendMessage(
    id: string,
    message: SessionMessageInput,
    idleMinutes: number = DEFAULT_IDLE_MINUTES,
  ): Promise<SessionMessageRecord> {
    const session = await this.findActiveById(id);
    if (!session) {
      throw new Error('Session not found, ended, or idle-expired');
    }

    const newIdleExpiresAt = new Date(Date.now() + idleMinutes * 60 * 1000);

    const created = await this.db.inferenceSessionMessage.create({
      data: {
        sessionId: id,
        role: message.role,
        content: message.content,
        tokenCount: message.tokenCount ?? null,
        ...(message.attachments ? { attachments: message.attachments as unknown as import('@prisma/client').Prisma.InputJsonValue } : {}),
        ...(message.parts !== undefined ? { parts: message.parts as unknown as import('@prisma/client').Prisma.InputJsonValue } : {}),
      },
    });

    // Refresh idle expiry on every turn — the session is alive.
    await this.db.inferenceSession.update({
      where: { id },
      data: { idleExpiresAt: newIdleExpiresAt },
    });

    return created;
  }

  /**
   * Close an active session. Idempotent: closing an already-ended session is a no-op success.
   * Returns the session row in its final state.
   */
  async endSession(id: string, reason: SessionEndReason): Promise<InferenceSessionRecord | null> {
    // Use updateMany so we can scope by status='active' and treat zero-row updates as no-ops.
    const result = await this.db.inferenceSession.updateMany({
      where: { id, status: 'active' },
      data: {
        status: 'ended',
        endedAt: new Date(),
        endReason: reason,
      },
    });

    // Whether or not we just transitioned, return the current row so the caller can inspect.
    return this.db.inferenceSession.findFirst({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }).then((row) => {
      void result;
      return row;
    });
  }

  /**
   * Find sessions that are still `active` but past their idleExpiresAt — candidates for
   * idle-timeout cleanup. The caller (idle-watcher worker) is responsible for ending them
   * and enqueuing analytics.
   */
  async findStaleSessions(args: FindStaleSessionsArgs = {}): Promise<InferenceSessionRecord[]> {
    const idleBefore = args.idleBefore ?? new Date();
    const limit = args.limit ?? 100;
    return this.db.inferenceSession.findMany({
      where: {
        status: 'active',
        idleExpiresAt: { lt: idleBefore },
      },
      orderBy: { idleExpiresAt: 'asc' },
      take: limit,
    });
  }

  /** Hard delete a session row. Cascades to messages. */
  async delete(id: string): Promise<InferenceSessionRecord> {
    return this.db.inferenceSession.delete({ where: { id } });
  }

  /**
   * Persist the workflow cursor for a session.
   * Pass `null` to clear the cursor (workflow ended or LLM fallback).
   */
  async setWorkflowState(
    id: string,
    cursor: { nodeId: string } | null,
  ): Promise<InferenceSessionRecord> {
    return this.db.inferenceSession.update({
      where: { id },
      data: { workflowState: cursor as unknown as import('@prisma/client').Prisma.InputJsonValue },
    });
  }
}
