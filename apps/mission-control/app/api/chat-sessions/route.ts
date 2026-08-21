import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat-sessions');

const createSessionSchema = z.object({
  name: z.string().min(1).optional(),
});

function toDTO(s: {
  id: string;
  name: string;
  threadId: string;
  messages: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { id: s.id, name: s.name, threadId: s.threadId, messages: s.messages, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) return null;
  return session;
}

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const sessions = await getPrismaClient().clawChatSession.findMany({
      where: { tenantId: session.studio.tenantId },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: sessions.map(toDTO) });
  } catch (error) {
    logger.error({ error }, 'Failed to list chat sessions');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const tenantId = session.studio.tenantId;
    const parsed = createSessionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const db = getPrismaClient();
    // Isolated LangGraph checkpoint thread per session — this is what makes
    // multiple independent conversations possible instead of the old single
    // thread-per-Claw design.
    const threadId = `claw_chat_${crypto.randomBytes(9).toString('base64url')}`;
    const count = await db.clawChatSession.count({ where: { tenantId } });
    const created = await db.clawChatSession.create({
      data: {
        tenantId,
        threadId,
        name: parsed.data.name?.trim() || `Thread ${count + 1}`,
        messages: [],
      },
    });
    logger.info({ tenantId, sessionId: created.id }, 'Chat session created');
    return NextResponse.json({ success: true, data: toDTO(created) }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create chat session');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
