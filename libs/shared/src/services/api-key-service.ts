import crypto from 'crypto';

export interface ApiKeyDb {
  apiKey: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

export interface CreateApiKeyInput {
  agentId: string;
  name: string;
  dailyReqLimit?: number;
  dailyTokenLimit?: number;
  scopes?: string[];
  expiresAt?: Date;
  createdBy: string;
}

export class ApiKeyService {
  constructor(
    private readonly tenantId: string,
    private readonly db: ApiKeyDb
  ) {}

  private generateRawKey(): string {
    const prefix = 'sk_';
    const random = crypto.randomBytes(36).toString('base64url');
    return prefix + random;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private getKeyPrefix(rawKey: string): string {
    return rawKey.slice(0, 12);
  }

  async create(input: CreateApiKeyInput): Promise<{ rawKey: string; apiKey: unknown }> {
    const rawKey = this.generateRawKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = this.getKeyPrefix(rawKey);

    const apiKey = await this.db.apiKey.create({
      data: {
        tenantId: this.tenantId,
        agentId: input.agentId,
        name: input.name,
        keyHash,
        keyPrefix,
        status: 'active',
        scopes: input.scopes ?? ['inference:read'],
        dailyReqLimit: input.dailyReqLimit ?? 1000,
        dailyTokenLimit: input.dailyTokenLimit ?? 100000,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy,
      },
    });

    return { rawKey, apiKey };
  }

  async validateKey(rawKey: string): Promise<boolean> {
    const keyHash = this.hashKey(rawKey);
    const key = await this.db.apiKey.findFirst({
      where: { keyHash, status: 'active' },
    });

    if (!key) return false;

    const record = key as { expiresAt: Date | null };
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return false;
    }

    return true;
  }

  async findByHash(keyHash: string) {
    return this.db.apiKey.findFirst({
      where: { keyHash, tenantId: this.tenantId },
    });
  }

  async findByAgentId(agentId: string) {
    return this.db.apiKey.findMany({
      where: { agentId, tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string) {
    return this.db.apiKey.update({
      where: { id, tenantId: this.tenantId },
      data: { status: 'revoked', updatedAt: new Date() },
    });
  }

  async rotate(id: string, gracePeriodHours = 24): Promise<{ rawKey: string; apiKey: unknown }> {
    const oldKey = await this.db.apiKey.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!oldKey) {
      throw new Error('API key not found');
    }

    await this.db.apiKey.update({
      where: { id, tenantId: this.tenantId },
      data: {
        status: 'rotating',
        expiresAt: new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
    });

    const old = oldKey as { agentId: string; name: string; dailyReqLimit: number; dailyTokenLimit: number; scopes: string[]; createdBy: string };
    return this.create({
      agentId: old.agentId,
      name: `${old.name} (rotated)`,
      dailyReqLimit: old.dailyReqLimit,
      dailyTokenLimit: old.dailyTokenLimit,
      scopes: old.scopes,
      createdBy: old.createdBy,
    });
  }

  async delete(id: string) {
    return this.db.apiKey.delete({
      where: { id, tenantId: this.tenantId },
    });
  }
}
