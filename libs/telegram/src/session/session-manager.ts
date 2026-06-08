import type { PrismaClient } from '@prisma/client';

export interface CreateSessionInput {
  tenantId: string;
  accountId: string;
  chatId: string;
  contactName: string | null;
  agentId: string;
}

export class TelegramSessionManager {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findActiveSession(accountId: string, chatId: string) {
    return (this.prisma as any).telegramSession.findFirst({
      where: { accountId, chatId, state: 'active' },
    });
  }

  async createSession(input: CreateSessionInput) {
    return (this.prisma as any).telegramSession.create({
      data: {
        tenantId: input.tenantId,
        accountId: input.accountId,
        chatId: input.chatId,
        contactName: input.contactName,
        agentId: input.agentId,
        state: 'active',
        context: {},
      },
    });
  }

  async updateContext(sessionId: string, context: Record<string, unknown>) {
    return (this.prisma as any).telegramSession.update({
      where: { id: sessionId },
      data: { context },
    });
  }

  async closeSession(sessionId: string) {
    return (this.prisma as any).telegramSession.update({
      where: { id: sessionId },
      data: { state: 'closed' },
    });
  }

  async switchAgent(sessionId: string, agentId: string) {
    return (this.prisma as any).telegramSession.update({
      where: { id: sessionId },
      data: { agentId, context: {} },
    });
  }
}
