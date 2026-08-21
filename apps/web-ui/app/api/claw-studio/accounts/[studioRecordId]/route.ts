/**
 * One Claw Studio account: rename it, or delete it outright.
 *
 * Sits alongside ../reset-password/route.ts and follows the same authorisation
 * model as the collection route: no `authorize()` call, because these operate on
 * the user's OTHER tenants where the current tenant's RBAC does not apply.
 * Membership is the authorisation, checked inside `StudioService`, and a
 * non-member gets "not found" rather than a 403 so the endpoint cannot be used to
 * discover which studio ids exist.
 */
import { NextRequest } from 'next/server';
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

const logger = createLogger('api:claw-studio:accounts:id');

const renameSchema = z.object({
  label: z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer'),
});

function unauthenticated(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Unauthenticated');
}

/**
 * "Studio not found" covers a bad id AND a non-member, deliberately (see the
 * module comment). The guard messages — deleting your current or only account —
 * are the user's own situation rather than someone else's data, so those are
 * returned verbatim as 400s.
 */
function statusFor(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'Internal server error';
  if (/not found/i.test(message)) return { status: 404, message: 'Studio not found' };
  if (/cannot delete|required|at most/i.test(message)) return { status: 400, message };
  // Everything else is a 500, but NOT an opaque one. A bare "Internal server
  // error" is what made the first real failure here undiagnosable: a Prisma P2021
  // (a table this database has not migrated yet) surfaced to the user as five
  // generic words, with the actual cause visible only to whoever thought to read
  // the server log. The Prisma code and message are operator-facing detail about
  // our own schema state, not user data, so they are safe to return and they turn
  // a support round trip into a one-line answer.
  const code = (error as { code?: string })?.code;
  return {
    status: 500,
    message: code ? `Could not delete the account (${code}): ${message}` : `Could not delete the account: ${message}`,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ studioRecordId: string }> },
) {
  let userId: string | undefined;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    userId = await getSessionUserId(authOptions);
    const { studioRecordId } = await params;

    const parsed = renameSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const service = new StudioService(tenantId, getPrismaClient());
    const result = await service.renameAccountForUser(studioRecordId, userId, parsed.data.label);

    await AuditService.logResourceAction({
      action: 'update',
      resourceType: 'ClawStudio',
      resourceId: studioRecordId,
      resourceName: result.tenantName,
      status: 'success',
      user: userId,
      userType: 'user',
      // Against the tenant the action was taken FROM, matching the create route —
      // that is where an admin would look for it.
      tenantId,
      source: 'platform',
      details: `Renamed Claw Studio account to "${result.tenantName}"`,
    });

    return Response.json(result);
  } catch (error) {
    if (unauthenticated(error)) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
    const { status, message } = statusFor(error);
    if (status === 500) logger.error({ error, userId }, 'Failed to rename a Claw Studio account');
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ studioRecordId: string }> },
) {
  let userId: string | undefined;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    userId = await getSessionUserId(authOptions);
    const { studioRecordId } = await params;

    const service = new StudioService(tenantId, getPrismaClient());
    const result = await service.deleteAccountForUser(studioRecordId, userId);

    logger.warn(
      { userId, deletedTenantId: result.tenantId, studioRecordId, deleted: result.deleted },
      'Deleted a Claw Studio account',
    );
    await AuditService.logResourceAction({
      action: 'delete',
      resourceType: 'ClawStudio',
      resourceId: studioRecordId,
      resourceName: result.tenantName,
      status: 'success',
      user: userId,
      userType: 'user',
      tenantId,
      source: 'platform',
      // The row counts go in the audit trail because the deletion itself is
      // irreversible — this is the only remaining record of what it removed.
      details: `Deleted Claw Studio account "${result.tenantName}" and its data (${
        Object.entries(result.deleted)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join(', ') || 'no associated rows'
      })`,
    });

    return Response.json(result);
  } catch (error) {
    if (unauthenticated(error)) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
    const { status, message } = statusFor(error);
    if (status === 500) logger.error({ error, userId }, 'Failed to delete a Claw Studio account');
    return Response.json({ error: message }, { status });
  }
}
