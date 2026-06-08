import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TelegramAccountBindingService,
  TelegramAccountBindingError,
  type TelegramAccountBindingDb,
} from './telegram-account-binding-service';

const mockTelegramAccount = {
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
};

const mockDb: TelegramAccountBindingDb = { telegramAccount: mockTelegramAccount };

const TENANT = 'tenant-1';
const AGENT = 'agent-1';

const triggerNode = (id: string, accountId?: string) => ({
  id,
  type: 'telegram_trigger',
  config: accountId ? { type: 'telegram_trigger', accountId } : { type: 'telegram_trigger' },
});

describe('TelegramAccountBindingService', () => {
  let service: TelegramAccountBindingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTelegramAccount.update.mockResolvedValue({});
    mockTelegramAccount.updateMany.mockResolvedValue({ count: 0 });
    service = new TelegramAccountBindingService(mockDb);
  });

  it('does nothing but clear stale bindings when no trigger has an accountId', async () => {
    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1')] });

    expect(mockTelegramAccount.findFirst).not.toHaveBeenCalled();
    expect(mockTelegramAccount.update).not.toHaveBeenCalled();
    expect(mockTelegramAccount.updateMany).toHaveBeenCalledWith({
      where: { agentId: AGENT },
      data: { agentId: null, triggerNodeId: null },
    });
  });

  it('binds an unbound account to this agent and clears other stale bindings', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: null,
      triggerNodeId: null,
      agent: null,
    });

    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] });

    expect(mockTelegramAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acct-1', tenantId: TENANT },
      include: { agent: { select: { name: true } } },
    });
    expect(mockTelegramAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { agentId: AGENT, triggerNodeId: 'n1' },
    });
    expect(mockTelegramAccount.updateMany).toHaveBeenCalledWith({
      where: { agentId: AGENT, id: { not: 'acct-1' } },
      data: { agentId: null, triggerNodeId: null },
    });
  });

  it('is idempotent when the account is already bound to this agent', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: AGENT,
      triggerNodeId: 'old-node',
      agent: { name: 'My Agent' },
    });

    await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] });

    expect(mockTelegramAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { agentId: AGENT, triggerNodeId: 'n1' },
    });
  });

  it('rejects binding to an account already bound to a different agent', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      tenantId: TENANT,
      agentId: 'other-agent',
      triggerNodeId: 'n9',
      agent: { name: 'Support Bot' },
    });

    await expect(
      service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-1')] }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'ALREADY_BOUND',
      message: 'This bot is already connected to "Support Bot"',
    });

    expect(mockTelegramAccount.update).not.toHaveBeenCalled();
  });

  it('rejects when more than one trigger node has an accountId', async () => {
    await expect(
      service.sync({
        tenantId: TENANT,
        agentId: AGENT,
        nodes: [triggerNode('n1', 'acct-1'), triggerNode('n2', 'acct-2')],
      }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'MULTIPLE_TRIGGERS',
    });

    expect(mockTelegramAccount.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when the selected account does not exist for this tenant', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-missing')] }),
    ).rejects.toMatchObject({
      name: 'TelegramAccountBindingError',
      code: 'ACCOUNT_NOT_FOUND',
    });
  });

  it('throws TelegramAccountBindingError instances that pass instanceof checks', async () => {
    mockTelegramAccount.findFirst.mockResolvedValue(null);

    try {
      await service.sync({ tenantId: TENANT, agentId: AGENT, nodes: [triggerNode('n1', 'acct-missing')] });
      expect.unreachable('expected sync to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramAccountBindingError);
    }
  });
});
