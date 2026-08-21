import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat-sessions:id');

// Every field the client persists must be listed. Zod STRIPS unknown keys by
// default rather than rejecting them, so a field missing here is dropped on save
// silently — no error, no warning, just a transcript that quietly loses its
// timestamps and run links.
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string().optional(),
  runId: z.string().optional(),
});

const updateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  messages: z.array(messageSchema).optional(),
}).strict();

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { sessionId } = await params;
    const row = await getPrismaClient().clawChatSession.findFirst({
      where: { id: sessionId, tenantId: session.studio.tenantId },
    });
    if (!row) return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: toDTO(row) });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch chat session');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { sessionId } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawChatSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!existing) return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });

    const parsed = updateSessionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const { name, messages } = parsed.data;
    const updated = await db.clawChatSession.update({
      where: { id: sessionId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(messages !== undefined ? { messages } : {}),
      },
    });
    return NextResponse.json({ success: true, data: toDTO(updated) });
  } catch (error) {
    logger.error({ error }, 'Failed to update chat session');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { sessionId } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawChatSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!existing) return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    await db.clawChatSession.delete({ where: { id: sessionId } });
    logger.info({ tenantId, sessionId }, 'Chat session deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete chat session');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
