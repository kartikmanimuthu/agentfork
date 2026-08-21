/**
 * Claw Studio accounts — the multi-account surface.
 *
 * Distinct from ../route.ts, which is tenant-scoped and can only ever see the
 * ONE studio belonging to the tenant the user is currently viewing chatflow as.
 * A user's accounts deliberately live in separate tenants (that is what makes
 * their memories, providers, skills and scheduled tasks isolated from each
 * other), so listing and creating them is driven by the user's `UserTenantRole`
 * memberships instead.
 */
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import {
  getSessionTenantId,
  getSessionUserId,
  getPrismaClient,
  StudioService,
  createLogger,
  AuditService,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio:accounts');

const createSchema = z.object({
  label: z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer'),
});

function unauthenticated(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Unauthenticated');
}

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    // No `authorize()` call here, unlike ../route.ts. That check is scoped to
    // the CURRENT tenant's RBAC, but this endpoint deliberately spans the
    // user's other tenants — where their role may differ. Membership itself is
    // the authorisation: `listForUser` only ever returns studios in tenants the
    // user has a UserTenantRole for.
    const service = new StudioService(tenantId, getPrismaClient());
    const accounts = await service.listForUser(userId);

    return Response.json({ accounts });
  } catch (error) {
    if (unauthenticated(error)) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
    logger.error({ error }, 'Failed to list Claw Studio accounts');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    userId = await getSessionUserId(authOptions);

    const session = (await getServerSession(authOptions)) as { user?: { email?: string } } | null;
    const email = session?.user?.email;
    if (!email) {
      // UserTenantRole stores the email alongside the membership, and a blank
      // one would make the new tenant's member list unreadable.
      return Response.json({ error: 'Your account has no email address' }, { status: 400 });
    }

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new StudioService(tenantId, getPrismaClient());
    const result = await service.createAccountForUser({ label: parsed.data.label, userId, email });

    logger.info(
      { userId, newTenantId: result.tenantId, studioId: result.studioId },
      'Created an additional Claw Studio account',
    );
    await AuditService.logResourceAction({
      action: 'create',
      resourceType: 'ClawStudio',
      resourceId: result.studioRecordId,
      resourceName: result.studioId,
      status: 'success',
      user: userId,
      userType: 'user',
      // Logged against the tenant the action was taken FROM, not the one just
      // created — that is where an admin would look for it.
      tenantId,
      source: 'platform',
      details: `Created Claw Studio account "${result.tenantName}"`,
    });

    // The password appears in this response and nowhere else, ever again.
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (unauthenticated(error)) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
    if (error instanceof Error && /at most|required/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    logger.error({ error, userId }, 'Failed to create a Claw Studio account');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
