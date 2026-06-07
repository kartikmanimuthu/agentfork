import type { PrismaClient } from '@prisma/client';
import type { TelegramWebhookEvent } from '../webhook/types';
import type { TelegramSessionManager } from '../session/session-manager';
import type { ContactLock } from '../concurrency/contact-lock';
import type { CircuitBreaker } from '../concurrency/circuit-breaker';
import type { TelegramBotApi } from '../client/bot-api';
import { TelegramCommandHandler } from '../session/command-handler';
import { createRouter } from '../router/factory';

export interface AgentExecutor {
  execute(
    agentId: string,
    message: { text?: string; mediaUrl?: string; mediaType?: string; mediaId?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }>;
}

export interface MessageProcessorDeps {
  prisma: PrismaClient;
  sessionManager: TelegramSessionManager;
  agentExecutor: AgentExecutor;
  contactLock: ContactLock;
  circuitBreaker: CircuitBreaker;
  botApiFactory: (botToken: string) => TelegramBotApi;
}

export class TelegramMessageProcessor {
  private readonly deps: MessageProcessorDeps;
  private readonly commandHandler = new TelegramCommandHandler();

  constructor(deps: MessageProcessorDeps) {
    this.deps = deps;
  }

  async processMessageEvent(event: TelegramWebhookEvent): Promise<void> {
    const { chatId, fromId, fromName, text, photoUrls, callbackData, isGroup } = event;

    const account = await (this.deps.prisma as any).telegramAccount.findFirst({
      where: { id: event.accountId ?? '' },
    });

    if (!account) return;

    const existing = await (this.deps.prisma as any).telegramMessage.findUnique({
      where: { telegramMessageId: String(event.updateId) },
    });
    if (existing) return;

    const lockAcquired = await this.deps.contactLock.acquire(account.id, chatId);
    if (!lockAcquired) return;

    try {
      if (this.deps.circuitBreaker.isOpen()) return;

      await (this.deps.prisma as any).telegramMessage.create({
        data: {
          tenantId: account.tenantId,
          accountId: account.id,
          telegramMessageId: String(event.updateId),
          direction: 'inbound',
          chatId,
          fromId,
          type: event.type,
          content: this.extractContent(event),
          status: 'received',
        },
      });

      const messageText = text ?? '';

      if (isGroup && !messageText.startsWith('/') && !messageText.includes(`@${account.botUsername ?? ''}`)) {
        return;
      }

      const command = this.commandHandler.parse(messageText);
      if (command) {
        await this.handleCommand(command, account, chatId);
        return;
      }

      let session = await this.deps.sessionManager.findActiveSession(account.id, chatId);

      if (!session) {
        const routing = await (this.deps.prisma as any).telegramRouting.findUnique({
          where: { accountId: account.id },
        });

        if (!routing) return;

        const rules = await (this.deps.prisma as any).telegramRoutingRule.findMany({
          where: { routingId: routing.id, isActive: true },
          orderBy: { priority: 'asc' },
        });

        const router = createRouter(routing.strategy);
        const routingResult = await router.route({
          message: event,
          chatId,
          fromName,
          accountId: account.id,
          routing: { strategy: routing.strategy, config: routing.config, fallbackAgentId: routing.fallbackAgentId },
          rules,
        });

        const agentId = routingResult.agentId;
        session = await this.deps.sessionManager.createSession({
          tenantId: account.tenantId,
          accountId: account.id,
          chatId,
          contactName: fromName,
          agentId,
        });
      }

      const agentResponse = await this.deps.agentExecutor.execute(
        session.agentId,
        { text: messageText, mediaType: event.type, mediaId: photoUrls?.[0] },
        {
          ...(session.context ?? {}),
          tg_chat_id: chatId,
          tg_from_id: fromId,
          tg_from_name: fromName,
          tg_message_type: event.type,
          tg_media_id: photoUrls?.[0] ?? null,
          tg_callback_data: callbackData ?? null,
          tg_account_id: account.id,
          tg_session_id: session.id,
          tg_is_group: isGroup,
          tenantId: account.tenantId,
        },
      );

      if (agentResponse.text) {
        const botApi = this.deps.botApiFactory(account.botToken);
        const sendResult = await botApi.sendMessage(chatId, agentResponse.text);
        this.deps.circuitBreaker.recordSuccess();

        await (this.deps.prisma as any).telegramMessage.create({
          data: {
            tenantId: account.tenantId,
            accountId: account.id,
            sessionId: session.id,
            telegramMessageId: String(sendResult.message_id),
            direction: 'outbound',
            chatId,
            fromId: null,
            type: 'text',
            content: { text: agentResponse.text },
            status: 'sent',
          },
        });
      } else {
        this.deps.circuitBreaker.recordSuccess();
      }
    } catch (error) {
      this.deps.circuitBreaker.recordFailure();
    } finally {
      await this.deps.contactLock.release(account.id, chatId);
    }
  }

  private async handleCommand(
    command: { type: string; agentName?: string },
    account: { id: string; botToken: string; tenantId: string },
    chatId: string,
  ): Promise<void> {
    const botApi = this.deps.botApiFactory(account.botToken);

    switch (command.type) {
      case 'reset': {
        const session = await this.deps.sessionManager.findActiveSession(account.id, chatId);
        if (session) await this.deps.sessionManager.closeSession(session.id);
        await botApi.sendMessage(chatId, 'Session reset. Send a message to start a new conversation.');
        break;
      }
      case 'help': {
        await botApi.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/reset - Start a new conversation\n/help - Show this message');
        break;
      }
      case 'start': {
        await botApi.sendMessage(chatId, 'Welcome! Send /help for available commands or just start chatting.');
        break;
      }
    }
  }

  private extractContent(event: TelegramWebhookEvent): Record<string, unknown> {
    switch (event.type) {
      case 'message':
        return { text: event.text, photoUrls: event.photoUrls, document: event.document };
      case 'callback_query':
        return { callbackData: event.callbackData };
      case 'edited_message':
        return { text: event.text, edited: true };
      case 'channel_post':
        return { text: event.text, channelPost: true };
      default:
        return { raw: event.rawUpdate };
    }
  }
}
