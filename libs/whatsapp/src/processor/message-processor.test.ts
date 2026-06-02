import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor';

const mockPrisma = {
  whatsAppAccount: { findFirst: vi.fn() },
  whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
  whatsAppSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  whatsAppRouting: { findUnique: vi.fn() },
  whatsAppRoutingRule: { findMany: vi.fn() },
};

const mockMetaClient = {
  sendTextMessage: vi.fn(),
  sendInteractiveMessage: vi.fn(),
};

const mockSessionManager = {
  findActiveSession: vi.fn(),
  createSession: vi.fn(),
  refreshWindow: vi.fn(),
  closeSession: vi.fn(),
  switchAgent: vi.fn(),
};

const mockAgentExecutor = {
  execute: vi.fn(),
};

const mockContactLock = {
  acquire: vi.fn(),
  release: vi.fn(),
};

const mockCircuitBreaker = {
  isOpen: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
};

describe('MessageProcessor', () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new MessageProcessor({
      prisma: mockPrisma as any,
      sessionManager: mockSessionManager as any,
      agentExecutor: mockAgentExecutor as any,
      contactLock: mockContactLock as any,
      circuitBreaker: mockCircuitBreaker as any,
      metaClientFactory: () => mockMetaClient as any,
    });
  });

  it('skips duplicate messages', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce({ id: 'existing' });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.dup', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).not.toHaveBeenCalled();
  });

  it('acquires contact lock before processing', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(false);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockContactLock.acquire).toHaveBeenCalledWith('acc_1', '15559876543');
    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
  });

  it('routes to existing session agent and executes', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockSessionManager.findActiveSession.mockResolvedValueOnce({ id: 'sess_1', agentId: 'agent_1', context: {} });
    mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Hello! How can I help?' });
    mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'wamid.out1' }] });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.2', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
    expect(mockAgentExecutor.execute).toHaveBeenCalledWith('agent_1', expect.objectContaining({ text: 'Hi' }), {});
    expect(mockMetaClient.sendTextMessage).toHaveBeenCalledWith('15559876543', 'Hello! How can I help?');
    expect(mockSessionManager.refreshWindow).toHaveBeenCalledWith('sess_1');
    expect(mockContactLock.release).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('rejects when circuit breaker is open', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1' });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(true);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.3', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
    expect(mockContactLock.release).toHaveBeenCalled();
  });
});
