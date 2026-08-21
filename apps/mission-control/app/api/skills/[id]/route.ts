import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { slugify } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills:id');

const updateSkillSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  tier: z.enum(['read-only', 'mutation', 'approval-gated']).optional(),
  content: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  slug: z.string().optional(),
}).strict();

function toDTO(s: { slug: string; name: string; description: string; tier: string; source: string; isEnabled: boolean; createdBy: string | null; content: string; createdAt: Date; updatedAt: Date }) {
  return { id: s.slug, name: s.name, description: s.description, tier: s.tier, source: s.source, isEnabled: s.isEnabled, createdBy: s.createdBy, content: s.content, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) return null;
  return session;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const skill = await getPrismaClient().clawSkill.findFirst({ where: { tenantId: session.studio.tenantId, slug: id } });
    if (!skill) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: toDTO(skill) });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug: id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });

    const parsed = updateSkillSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const { slug: newSlugRaw, ...rest } = parsed.data;
    const updates: Record<string, unknown> = { ...rest };
    if (newSlugRaw !== undefined) updates.slug = slugify(newSlugRaw);

    let updated;
    try {
      updated = await db.clawSkill.update({ where: { id: existing.id }, data: updates });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ success: false, error: `A skill with slug "${updates.slug ?? existing.slug}" already exists` }, { status: 409 });
      }
      throw err;
    }
    logger.info({ tenantId, slug: id }, 'Skill updated');
    return NextResponse.json({ success: true, data: toDTO(updated) });
  } catch (error) {
    logger.error({ error }, 'Failed to update skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug: id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });
    await db.clawSkill.delete({ where: { id: existing.id } });
    logger.info({ tenantId, slug: id }, 'Skill deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
