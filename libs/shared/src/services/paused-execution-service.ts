interface PausedExecutionDb {
  pausedExecution: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; resumeToken: string }>;
    findUnique(args: { where: { resumeToken: string } }): Promise<PausedExecutionRow | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  apiKeyExecution: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface PausedExecutionRow {
  id: string;
  resumeToken: string;
  tenantId: string;
  agentId: string;
  executionId: string;
  graphState: unknown;
  prompt: string;
  outputChannel: string;
  nextNodeId: string | null;
  expiresAt: Date;
  resumedAt: Date | null;
  createdAt: Date;
}

export interface CreatePausedExecutionInput {
  tenantId: string;
  agentId: string;
  executionId: string;
  graphState: unknown;
  prompt: string;
  outputChannel: string;
  nextNodeId: string | null;
}

const EXPIRY_HOURS = 24;

export class PausedExecutionService {
  constructor(private readonly db: PausedExecutionDb) {}

  async create(input: CreatePausedExecutionInput): Promise<{ id: string; resumeToken: string }> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
    return this.db.pausedExecution.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        executionId: input.executionId,
        graphState: input.graphState as Record<string, unknown>,
        prompt: input.prompt,
        outputChannel: input.outputChannel,
        nextNodeId: input.nextNodeId,
        expiresAt,
      },
    });
  }

  // Atomically claims a resume token. WHERE resumeToken=? AND resumedAt IS NULL AND expiresAt > now.
  // Only one concurrent caller wins when count=1; others get null.
  async claimToken(resumeToken: string): Promise<PausedExecutionRow | null> {
    const result = await this.db.pausedExecution.updateMany({
      where: {
        resumeToken,
        resumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { resumedAt: new Date() },
    });

    if (result.count === 0) return null;

    return this.db.pausedExecution.findUnique({ where: { resumeToken } });
  }

  async expireOld(): Promise<number> {
    const result = await this.db.pausedExecution.updateMany({
      where: {
        resumedAt: null,
        expiresAt: { lt: new Date() },
      },
      data: { resumedAt: new Date() },
    });
    return result.count;
  }
}
