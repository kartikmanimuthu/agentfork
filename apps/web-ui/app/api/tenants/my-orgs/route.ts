import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, TenantConfigService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:tenants:my-orgs');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const prisma = getPrismaClient();

    // Get all tenant memberships for this user
    const utrs = await prisma.userTenantRole.findMany({
      where: { userId: session.user.id },
      select: { tenantId: true, role: true },
    });

    if (utrs.length === 0) {
      return NextResponse.json({ orgs: [] });
    }

    const tenantIds = utrs.map((u) => u.tenantId);

    // Fetch tenant names and slugs
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true, slug: true },
    });

    // Enrich with logo from TenantConfig (configKey = 'org_logo')
    const orgs = await Promise.all(
      tenants.map(async (t) => {
        const configService = new TenantConfigService(t.id);
        const logo = await configService.get<{ url?: string }>('org_logo');
        const utr = utrs.find((u) => u.tenantId === t.id);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          role: utr?.role ?? null,
          logoUrl: logo?.url ?? null,
        };
      }),
    );

    logger.info({ userId: session.user.id, orgCount: orgs.length }, 'Fetched organizations');

    return NextResponse.json({ orgs });
  } catch (error) {
    logger.error({ error }, 'Error fetching organizations');
    return NextResponse.json(
      { error: 'Failed to fetch organizations' },
      { status: 500 },
    );
  }
}
