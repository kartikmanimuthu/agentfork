import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from './message-processor';
import { SessionManager } from '../session/session-manager';
import { ContactLock, InMemoryLockProvider } from '../concurrency/contact-lock';
import { CircuitBreaker } from '../concurrency/circuit-breaker';

describe('MessageProcessor Integration', () => {
  let processor: MessageProcessor;
  const sentMessages: Array<{ to: string; text: string }> = [];

  const mockPrisma = {
    whatsAppAccount: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'acc_1',
        tenantId: 'tenant_1',
        accessToken: 'encrypted_token',
        phoneNumberId: 'PH1',
      }),
    },
    whatsAppMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    whatsAppSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sess_new', ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppRouting: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'routing_1',
        strategy: 'keyword',
        config: {},
        fallbackAgentId: 'agent_default',
      }),
    },
    whatsAppRoutingRule: {
      findMany: vi.fn().mockResolvedValue([
        { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: true },
        { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
      ]),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sentMessages.length = 0;
    mockPrisma.whatsAppSession.findFirst.mockResolvedValue(null);
    mockPrisma.whatsAppMessage.findUnique.mockResolvedValue(null);

    const sessionManager = new SessionManager(mockPrisma as any);
    const contactLock = new ContactLock(new InMemoryLockProvider());
    const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });

    processor = new MessageProcessor({
      prisma: mockPrisma as any,
      sessionManager,
      agentExecutor: {
        async execute(agentId, message) {
          return { text: `[${agentId}] Response to: ${message.text}` };
        },
      },
      contactLock,
      circuitBreaker,
      metaClientFactory: () => ({
        sendTextMessage: vi.fn().mockImplementation(async (to, text) => {
          sentMessages.push({ to, text });
          return { messages: [{ id: `wamid.out_${Date.now()}` }] };
        }),
        sendInteractiveMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.interactive' }] }),
      }) as any,
    });
  });

  it('routes a new message through keyword router and executes agent', async () => {
    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Alice' }, wa_id: '15551234567' },
      message: { from: '15551234567', id: 'wamid.new1', timestamp: '1700000000', type: 'text', text: { body: 'I need sales help' } },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe('15551234567');
    expect(sentMessages[0].text).toContain('agent_sales');
    expect(sentMessages[0].text).toContain('I need sales help');
  });

  it('uses fallback agent when no keyword matches', async () => {
    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Bob' }, wa_id: '15559999999' },
      message: { from: '15559999999', id: 'wamid.new2', timestamp: '1700000000', type: 'text', text: { body: 'Hello there' } },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('agent_default');
  });

  it('reuses existing session on subsequent messages', async () => {
    mockPrisma.whatsAppSession.findFirst.mockResolvedValueOnce({
      id: 'sess_existing',
      agentId: 'agent_sales',
      context: {},
      windowExpiresAt: new Date(Date.now() + 86400000),
    });

    await processor.processMessageEvent({
      type: 'message',
      phoneNumberId: 'PH1',
      contact: { profile: { name: 'Alice' }, wa_id: '15551234567' },
      message: { from: '15551234567', id: 'wamid.followup', timestamp: '1700000000', type: 'text', text: { body: 'Follow up question' } },
    });

    expect(sentMessages[0].text).toContain('agent_sales');
    expect(mockPrisma.whatsAppRouting.findUnique).not.toHaveBeenCalled();
  });

  it('handles status update events', async () => {
    await processor.processStatusEvent({
      type: 'status',
      phoneNumberId: 'PH1',
      status: { id: 'wamid.out1', status: 'delivered', timestamp: '1700000001', recipient_id: '15551234567' },
    });

    expect(mockPrisma.whatsAppMessage.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: 'wamid.out1' },
      data: expect.objectContaining({ status: 'delivered' }),
    });
  });
});
