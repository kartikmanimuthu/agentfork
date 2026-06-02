import type { PrismaClient } from '@prisma/client';
import type { ParsedEvent } from '../webhook/types';
import type { SessionManager } from '../session/session-manager';
import type { ContactLock } from '../concurrency/contact-lock';
import type { CircuitBreaker } from '../concurrency/circuit-breaker';
import type { MetaWhatsAppClient } from '../client/meta-api';
import { CommandHandler } from '../session/command-handler';
import { createRouter } from '../router/factory';

export interface AgentExecutor {
  execute(agentId: string, message: { text?: string; mediaUrl?: string; mediaType?: string }, context: Record<string, unknown>): Promise<{ text: string }>;
}

export interface MessageProcessorDeps {
  prisma: PrismaClient;
  sessionManager: SessionManager;
  agentExecutor: AgentExecutor;
  contactLock: ContactLock;
  circuitBreaker: CircuitBreaker;
  metaClientFactory: (accessToken: string, phoneNumberId: string) => MetaWhatsAppClient;
}

export class MessageProcessor {
  private readonly deps: MessageProcessorDeps;
  private readonly commandHandler = new CommandHandler();

  constructor(deps: MessageProcessorDeps) {
    this.deps = deps;
  }

  async processMessageEvent(event: Extract<ParsedEvent, { type: 'message' }>): Promise<void> {
    const { phoneNumberId, contact, message } = event;

    const account = await (this.deps.prisma as any).whatsAppAccount.findFirst({
      where: { phoneNumberId },
    });

    if (!account) return;

    const existing = await (this.deps.prisma as any).whatsAppMessage.findUnique({
      where: { waMessageId: message.id },
    });
    if (existing) return;

    const lockAcquired = await this.deps.contactLock.acquire(account.id, contact.wa_id);
    if (!lockAcquired) return;

    try {
      if (this.deps.circuitBreaker.isOpen()) return;

      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          waMessageId: message.id,
          direction: 'inbound',
          contactPhone: contact.wa_id,
          type: message.type,
          content: this.extractContent(message),
          status: 'received',
        },
      });

      const messageText = message.text?.body ?? '';
      const command = this.commandHandler.parse(messageText);
      if (command) {
        await this.handleCommand(command, account, contact.wa_id);
        return;
      }

      let session = await this.deps.sessionManager.findActiveSession(account.id, contact.wa_id);

      if (!session) {
        const routing = await (this.deps.prisma as any).whatsAppRouting.findUnique({
          where: { accountId: account.id },
        });

        if (!routing) return;

        const rules = await (this.deps.prisma as any).whatsAppRoutingRule.findMany({
          where: { routingId: routing.id, isActive: true },
          orderBy: { priority: 'asc' },
        });

        const router = createRouter(routing.strategy);
        const routingResult = await router.route({
          message,
          contactPhone: contact.wa_id,
          contactName: contact.profile.name,
          accountId: account.id,
          routing: { strategy: routing.strategy, config: routing.config, fallbackAgentId: routing.fallbackAgentId },
          rules,
        });

        if (routingResult.type === 'prompt') {
          const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
          await metaClient.sendInteractiveMessage(contact.wa_id, routingResult.interactiveMessage);
          return;
        }

        const agentId = routingResult.agentId;
        session = await this.deps.sessionManager.createSession({
          accountId: account.id,
          contactPhone: contact.wa_id,
          contactName: contact.profile.name,
          agentId,
        });
      }

      const agentResponse = await this.deps.agentExecutor.execute(
        session.agentId,
        { text: messageText },
        session.context ?? {},
      );

      const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
      const sendResult = await metaClient.sendTextMessage(contact.wa_id, agentResponse.text);
      this.deps.circuitBreaker.recordSuccess();

      await (this.deps.prisma as any).whatsAppMessage.create({
        data: {
          accountId: account.id,
          sessionId: session.id,
          waMessageId: sendResult.messages[0].id,
          direction: 'outbound',
          contactPhone: contact.wa_id,
          type: 'text',
          content: { text: agentResponse.text },
          status: 'sent',
        },
      });

      await this.deps.sessionManager.refreshWindow(session.id);

    } catch (error) {
      this.deps.circuitBreaker.recordFailure();
    } finally {
      await this.deps.contactLock.release(account.id, contact.wa_id);
    }
  }

  async processStatusEvent(event: Extract<ParsedEvent, { type: 'status' }>): Promise<void> {
    const { status } = event;

    await (this.deps.prisma as any).whatsAppMessage.updateMany({
      where: { waMessageId: status.id },
      data: {
        status: status.status,
        statusTimestamp: new Date(parseInt(status.timestamp) * 1000),
        errorCode: status.errors?.[0]?.code?.toString(),
        errorMessage: status.errors?.[0]?.message,
      },
    });
  }

  private async handleCommand(
    command: { type: string; agentName?: string },
    account: { id: string; accessToken: string; phoneNumberId: string },
    contactPhone: string,
  ): Promise<void> {
    const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);

    switch (command.type) {
      case 'reset': {
        const session = await this.deps.sessionManager.findActiveSession(account.id, contactPhone);
        if (session) await this.deps.sessionManager.closeSession(session.id);
        await metaClient.sendTextMessage(contactPhone, 'Session reset. Send a message to start a new conversation.');
        break;
      }
      case 'help': {
        await metaClient.sendTextMessage(contactPhone, 'Available commands:\n/reset - Start a new conversation\n/switch <agent> - Switch to a different agent\n/help - Show this message');
        break;
      }
      case 'switch': {
        const session = await this.deps.sessionManager.findActiveSession(account.id, contactPhone);
        if (!session) {
          await metaClient.sendTextMessage(contactPhone, 'No active session. Send a message to start a new conversation.');
        } else if (!command.agentName) {
          await metaClient.sendTextMessage(contactPhone, 'Usage: /switch <agent-name>');
        } else {
          await metaClient.sendTextMessage(contactPhone, `Switched to agent: ${command.agentName}`);
        }
        break;
      }
    }
  }

  private extractContent(message: any): Record<string, unknown> {
    switch (message.type) {
      case 'text':
        return { text: message.text?.body };
      case 'image':
        return { mediaId: message.image?.id, mimeType: message.image?.mime_type, caption: message.image?.caption };
      case 'document':
        return { mediaId: message.document?.id, mimeType: message.document?.mime_type, filename: message.document?.filename, caption: message.document?.caption };
      case 'interactive':
        return { interactive: message.interactive };
      default:
        return { raw: message };
    }
  }
}
