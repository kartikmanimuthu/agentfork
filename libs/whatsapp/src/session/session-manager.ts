import type { PrismaClient } from '@prisma/client';

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  accountId: string;
  contactPhone: string;
  contactName: string | null;
  agentId: string;
}

export class SessionManager {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findActiveSession(accountId: string, contactPhone: string) {
    const session = await (this.prisma as any).whatsAppSession.findFirst({
      where: { accountId, contactPhone, state: 'active' },
    });

    if (!session) return null;

    if (new Date() > session.windowExpiresAt) {
      await (this.prisma as any).whatsAppSession.update({
        where: { id: session.id },
        data: { state: 'expired' },
      });
      return null;
    }

    return session;
  }

  async createSession(input: CreateSessionInput) {
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    return (this.prisma as any).whatsAppSession.create({
      data: {
        accountId: input.accountId,
        contactPhone: input.contactPhone,
        contactName: input.contactName,
        agentId: input.agentId,
        state: 'active',
        context: {},
        lastMessageAt: now,
        windowExpiresAt,
      },
    });
  }

  async refreshWindow(sessionId: string) {
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: now, windowExpiresAt },
    });
  }

  async updateContext(sessionId: string, context: Record<string, unknown>) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { context },
    });
  }

  async closeSession(sessionId: string) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { state: 'closed' },
    });
  }

  async switchAgent(sessionId: string, agentId: string) {
    return (this.prisma as any).whatsAppSession.update({
      where: { id: sessionId },
      data: { agentId, context: {} },
    });
  }
}
