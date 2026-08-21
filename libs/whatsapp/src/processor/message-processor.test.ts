import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor';

const mockPrisma = {
  whatsAppAccount: { findFirst: vi.fn() },
  whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
  whatsAppSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  whatsAppRouting: { findUnique: vi.fn() },
  whatsAppRoutingRule: { findMany: vi.fn() },
  whatsAppAllowedContact: { findUnique: vi.fn() },
};

const mockMetaClient = {
  sendTextMessage: vi.fn(),
  sendInteractiveMessage: vi.fn(),
};

const mockSessionManager = {
  findActiveSession: vi.fn(),
  createSession: vi.fn(),
  refreshWindow: vi.fn(),
  updateContext: vi.fn(),
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
      clientFactory: () => mockMetaClient as any,
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
    expect(mockAgentExecutor.execute).toHaveBeenCalledWith(
      'agent_1',
      expect.objectContaining({ text: 'Hi', mediaType: 'text' }),
      expect.objectContaining({ wa_sender_id: '15559876543', wa_session_id: 'sess_1' }),
    );
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

  it('skips processing for a non-allowlisted contact but still stores the inbound message', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: true });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppAllowedContact.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.notallowed', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockPrisma.whatsAppMessage.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.whatsAppAllowedContact.findUnique).toHaveBeenCalledWith({
      where: { accountId_phoneNumber: { accountId: 'acc_1', phoneNumber: '15559876543' } },
    });
    expect(mockSessionManager.findActiveSession).not.toHaveBeenCalled();
    expect(mockAgentExecutor.execute).not.toHaveBeenCalled();
    expect(mockContactLock.release).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('processes normally for an allowlisted contact when restrictToAllowlist is true', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: true });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppAllowedContact.findUnique.mockResolvedValueOnce({ id: 'allow_1', accountId: 'acc_1', phoneNumber: '15559876543' });
    mockPrisma.whatsAppRouting.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.allowed', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('does not check the allowlist when restrictToAllowlist is false', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', restrictToAllowlist: false });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockPrisma.whatsAppRouting.findUnique.mockResolvedValueOnce(null);

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.unrestricted', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockPrisma.whatsAppAllowedContact.findUnique).not.toHaveBeenCalled();
    expect(mockSessionManager.findActiveSession).toHaveBeenCalledWith('acc_1', '15559876543');
  });

  it('uses account.agentId directly without routing when set', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_1',
      tenantId: 'tenant_1',
      accessToken: 'token',
      phoneNumberId: 'PH1',
      provider: 'netcore',
      restrictToAllowlist: false,
      agentId: 'agent_direct',
    });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockPrisma.whatsAppMessage.create.mockResolvedValueOnce({});
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValueOnce(false);
    mockSessionManager.findActiveSession.mockResolvedValueOnce(null);
    mockSessionManager.createSession.mockResolvedValueOnce({
      id: 'session_1',
      agentId: 'agent_direct',
      lastMessageAt: null,
      context: {},
    });
    mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Hello!' });
    mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'out_1' }] });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Omar' }, wa_id: '919876543210' },
      message: { from: '919876543210', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
    });

    expect(mockSessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent_direct' }),
    );
    expect(mockPrisma.whatsAppRouting.findUnique).not.toHaveBeenCalled();
    expect(mockAgentExecutor.execute).toHaveBeenCalledWith(
      'agent_direct',
      expect.anything(),
      expect.anything(),
    );
  });

  it('saves user and assistant messages to session context after each turn', async () => {
    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', tenantId: 't1', provider: 'meta', restrictToAllowlist: false, agentId: null });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockSessionManager.findActiveSession.mockResolvedValueOnce({ id: 'sess_1', agentId: 'agent_1', context: {}, lastMessageAt: null });
    mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Here are our plans' });
    mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'wamid.out1' }] });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.2', timestamp: '1', type: 'text', text: { body: 'I want a plan' } },
    });

    expect(mockSessionManager.updateContext).toHaveBeenCalledWith('sess_1', {
      messages: [
        { role: 'user', content: 'I want a plan' },
        { role: 'assistant', content: 'Here are our plans' },
      ],
    });
  });

  it('passes existing history to agent and trims to last 30 messages', async () => {
    // 32 existing + 2 new = 34 total → trimmed to 30
    const existingMessages = Array.from({ length: 32 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));

    mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({ id: 'acc_1', accessToken: 'enc', phoneNumberId: 'PH1', tenantId: 't1', provider: 'meta', restrictToAllowlist: false, agentId: null });
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
    mockContactLock.acquire.mockResolvedValueOnce(true);
    mockCircuitBreaker.isOpen.mockReturnValue(false);
    mockPrisma.whatsAppMessage.create.mockResolvedValue({});
    mockSessionManager.findActiveSession.mockResolvedValueOnce({ id: 'sess_1', agentId: 'agent_1', context: { messages: existingMessages }, lastMessageAt: null });
    mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Got it' });
    mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'wamid.out2' }] });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'John' }, wa_id: '15559876543' },
      message: { from: '15559876543', id: 'wamid.3', timestamp: '1', type: 'text', text: { body: 'New message' } },
    });

    const savedMessages = (mockSessionManager.updateContext.mock.calls[0][1] as any).messages;
    expect(savedMessages).toHaveLength(30);
    // oldest messages dropped, newest retained
    expect(savedMessages[savedMessages.length - 2]).toEqual({ role: 'user', content: 'New message' });
    expect(savedMessages[savedMessages.length - 1]).toEqual({ role: 'assistant', content: 'Got it' });
  });
});
