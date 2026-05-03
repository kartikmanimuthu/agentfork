import { getPrismaClient } from '../db/prisma-client';
import { AuditService } from './audit-service';

export class InvitationService {
  static async createInvitation(
    tenantId: string,
    email: string,
    role: string,
    invitedBy: string,
  ) {
    const prisma = getPrismaClient();

    const existingInvitation = await prisma.invitation.findFirst({
      where: { tenantId, email, status: 'pending' },
    });
    if (existingInvitation) {
      throw new Error('An invitation is already pending for this email');
    }

    const existingMember = await prisma.userTenantRole.findFirst({
      where: { tenantId, email },
    });
    if (existingMember) {
      throw new Error('This user is already a member of your organization');
    }

    const existingUser = await prisma.authUser.findUnique({
      where: { email },
    });
    const hasActiveMembership = existingUser
      ? !!(await prisma.userTenantRole.findFirst({ where: { userId: existingUser.id } }))
      : false;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (existingUser && hasActiveMembership) {
      const customRole = await prisma.customRole.findFirst({
        where: { tenantId, name: role },
      });
      await prisma.userTenantRole.create({
        data: {
          userId: existingUser.id,
          tenantId,
          email,
          role,
          roleId: customRole?.id ?? null,
          assignedAt: new Date(),
          assignedBy: invitedBy,
        },
      });

      const invitation = await prisma.invitation.create({
        data: {
          tenantId,
          email,
          role,
          invitedBy,
          status: 'accepted',
          expiresAt,
        },
      });

      return { invitation, autoJoined: true };
    }

    const invitation = await prisma.invitation.create({
      data: {
        tenantId,
        email,
        role,
        invitedBy,
        status: 'pending',
        expiresAt,
      },
    });

    return { invitation, autoJoined: false };
  }

  static async listInvitations(tenantId: string) {
    const prisma = getPrismaClient();
    const invitations = await prisma.invitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const toExpire = invitations.filter(
      (inv) => inv.status === 'pending' && inv.expiresAt < now,
    );

    if (toExpire.length > 0) {
      await prisma.invitation.updateMany({
        where: {
          id: { in: toExpire.map((inv) => inv.id) },
          status: 'pending',
        },
        data: { status: 'expired' },
      });
      for (const inv of invitations) {
        if (toExpire.some((e) => e.id === inv.id)) {
          inv.status = 'expired';
        }
      }
    }

    return invitations;
  }

  static async resendInvitation(invitationId: string, tenantId: string) {
    const prisma = getPrismaClient();

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, tenantId, status: 'pending' },
    });
    if (!invitation) {
      throw new Error('Invitation not found or not in pending status');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: { expiresAt },
    });

    return updated;
  }

  static async revokeInvitation(invitationId: string, tenantId: string) {
    const prisma = getPrismaClient();

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, tenantId, status: 'pending' },
    });
    if (!invitation) {
      throw new Error('Invitation not found or not in pending status');
    }

    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });

    return updated;
  }

  static async acceptPendingInvitation(userId: string, email: string) {
    const prisma = getPrismaClient();

    const pendingInvitations = await prisma.invitation.findMany({
      where: { email, status: 'pending' },
    });

    for (const invitation of pendingInvitations) {
      try {
        const existingRole = await prisma.userTenantRole.findFirst({
          where: { userId, tenantId: invitation.tenantId },
        });

        if (!existingRole) {
          const customRole = await prisma.customRole.findFirst({
            where: { tenantId: invitation.tenantId, name: invitation.role },
          });
          await prisma.userTenantRole.create({
            data: {
              userId,
              tenantId: invitation.tenantId,
              email,
              role: invitation.role,
              roleId: customRole?.id ?? null,
              assignedAt: new Date(),
              assignedBy: invitation.invitedBy,
            },
          });
        }

        await prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: 'accepted' },
        });

        AuditService.logUserAction({
          eventType: 'rbac.member.invitation_accepted',
          action: 'Accepted Invitation',
          resourceType: 'invitation',
          resourceId: invitation.id,
          resourceName: invitation.email,
          user: invitation.email,
          userType: 'user',
          status: 'success',
          severity: 'medium',
          details: `User ${invitation.email} accepted invitation to ${invitation.tenantId}`,
          metadata: { tenantId: invitation.tenantId, invitationId: invitation.id, email: invitation.email, role: invitation.role },
          tenantId: invitation.tenantId,
        }).catch(() => {});
      } catch (err) {
        console.error(
          `InvitationService.acceptPendingInvitation: failed for invitation ${invitation.id}:`,
          err,
        );
      }
    }
  }
}
