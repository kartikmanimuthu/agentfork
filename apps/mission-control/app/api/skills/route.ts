import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { slugify } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills');

const createSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tier: z.enum(['read-only', 'mutation', 'approval-gated']),
  content: z.string().min(1),
  isEnabled: z.boolean().optional().default(true),
  slug: z.string().optional(),
  source: z.enum(['user', 'system']).optional().default('user'),
  sourceRunId: z.string().nullable().optional(),
});

function toDTO(
  s: { slug: string; name: string; description: string; tier: string; source: string; isEnabled: boolean; createdBy: string | null; createdAt: Date; updatedAt: Date; content?: string },
  includeContent = false,
) {
  const dto = {
    id: s.slug, name: s.name, description: s.description, tier: s.tier, source: s.source,
    isEnabled: s.isEnabled, createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
  return includeContent ? { ...dto, content: s.content } : dto;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const includeDisabled = params.has('all');
    const withContent = params.has('withContent');
    const skills = await getPrismaClient().clawSkill.findMany({
      where: { tenantId: session.studio.tenantId, ...(includeDisabled ? {} : { isEnabled: true }) },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ success: true, skills: skills.map((s) => toDTO(s, withContent)) });
  } catch (error) {
    logger.error({ error }, 'Failed to list skills');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const parsed = createSkillSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const tenantId = session.studio.tenantId;
    const { name, description, tier, content, isEnabled, source, sourceRunId } = parsed.data;
    const slug = parsed.data.slug?.trim() ? slugify(parsed.data.slug) : slugify(name);

    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug } });
    if (existing) {
      return NextResponse.json({ success: false, error: `A skill with slug "${slug}" already exists` }, { status: 409 });
    }

    let created;
    try {
      created = await db.clawSkill.create({
        data: { tenantId, slug, name, description, tier, content, source, isEnabled, createdBy: null, sourceRunId: sourceRunId ?? null },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ success: false, error: `A skill with slug "${slug}" already exists` }, { status: 409 });
      }
      throw err;
    }
    logger.info({ tenantId, slug }, 'Skill created');
    return NextResponse.json({ success: true, data: toDTO(created) }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
