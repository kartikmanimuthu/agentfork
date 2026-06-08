import { createLogger } from '../logging/logger';

const logger = createLogger('telegram-account-binding-service');

export type TelegramAccountBindingErrorCode = 'MULTIPLE_TRIGGERS' | 'ACCOUNT_NOT_FOUND' | 'ALREADY_BOUND';

export class TelegramAccountBindingError extends Error {
  readonly code: TelegramAccountBindingErrorCode;

  constructor(message: string, code: TelegramAccountBindingErrorCode) {
    super(message);
    this.name = 'TelegramAccountBindingError';
    this.code = code;
  }
}

interface TelegramAccountBindingRow {
  id: string;
  tenantId: string;
  agentId: string | null;
  triggerNodeId: string | null;
  agent: { name: string } | null;
}

export interface TelegramAccountBindingDb {
  telegramAccount: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      include: { agent: { select: { name: true } } };
    }): Promise<TelegramAccountBindingRow | null>;
    update(args: {
      where: { id: string };
      data: { agentId: string | null; triggerNodeId: string | null };
    }): Promise<unknown>;
    updateMany(args: {
      where: { agentId: string; id?: { not: string } };
      data: { agentId: null; triggerNodeId: null };
    }): Promise<{ count: number }>;
  };
}

interface GraphNodeLike {
  id: string;
  type: string;
  config?: { accountId?: unknown } | null;
}

export interface SyncTelegramAccountBindingInput {
  tenantId: string;
  agentId: string;
  nodes: GraphNodeLike[];
}

function extractAccountId(node: GraphNodeLike): string | undefined {
  const accountId = node.config?.accountId;
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined;
}

export class TelegramAccountBindingService {
  constructor(private readonly db: TelegramAccountBindingDb) {}

  async sync(input: SyncTelegramAccountBindingInput): Promise<void> {
    const { tenantId, agentId, nodes } = input;

    try {
      const boundTriggers = nodes
        .filter((n) => n.type === 'telegram_trigger')
        .map((n) => ({ nodeId: n.id, accountId: extractAccountId(n) }))
        .filter((t): t is { nodeId: string; accountId: string } => Boolean(t.accountId));

      if (boundTriggers.length > 1) {
        throw new TelegramAccountBindingError(
          'Only one Telegram Trigger can be bound to an account per agent',
          'MULTIPLE_TRIGGERS',
        );
      }

      const chosen = boundTriggers[0];

      if (chosen) {
        const account = await this.db.telegramAccount.findFirst({
          where: { id: chosen.accountId, tenantId },
          include: { agent: { select: { name: true } } },
        });

        if (!account) {
          throw new TelegramAccountBindingError('Selected Telegram account was not found', 'ACCOUNT_NOT_FOUND');
        }

        if (account.agentId && account.agentId !== agentId) {
          throw new TelegramAccountBindingError(
            `This bot is already connected to "${account.agent?.name ?? 'another agent'}"`,
            'ALREADY_BOUND',
          );
        }

        await this.db.telegramAccount.update({
          where: { id: account.id },
          data: { agentId, triggerNodeId: chosen.nodeId },
        });
      }

      await this.db.telegramAccount.updateMany({
        where: {
          agentId,
          ...(chosen ? { id: { not: chosen.accountId } } : {}),
        },
        data: { agentId: null, triggerNodeId: null },
      });

      logger.info(
        { tenantId, agentId, accountId: chosen?.accountId ?? null },
        'Telegram account binding synced',
      );
    } catch (error) {
      logger.error({ tenantId, agentId, error }, 'Failed to sync Telegram account binding');
      throw error;
    }
  }
}
