import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPrismaClient } from '../db/prisma-client';
import { createLogger } from '../logging/logger';
import { AuditService } from './audit-service';

const logger = createLogger('invitation-service');
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getCognitoClient, COGNITO_USER_POOL_ID } from '../auth/cognito-client';

function generateTempPassword(): string {
  const base = crypto.randomBytes(9).toString('base64url');
  return base + 'A1!';
}

function isCognitoConfigured(): boolean {
  return !!COGNITO_USER_POOL_ID;
}

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

    // Remove any previous non-pending invitation to satisfy the unique constraint
    const previousInvitation = await prisma.invitation.findFirst({
      where: { tenantId, email },
    });
    if (previousInvitation) {
      await prisma.invitation.delete({ where: { id: previousInvitation.id } });
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

    // New user path: generate temp password, create AuthUser, and call Cognito to send email
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const existingAuthUser = await prisma.authUser.findUnique({ where: { email } });
    if (existingAuthUser) {
      await prisma.authUser.update({
        where: { email },
        data: { passwordHash },
      });
    } else {
      await prisma.authUser.create({
        data: { email, passwordHash, isSuperAdmin: false },
      });
    }

    if (isCognitoConfigured()) {
      try {
        const cognitoClient = getCognitoClient();
        try {
          await cognitoClient.send(
            new AdminCreateUserCommand({
              UserPoolId: COGNITO_USER_POOL_ID,
              Username: email,
              TemporaryPassword: tempPassword,
              UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
              ],
              DesiredDeliveryMediums: ['EMAIL'],
            }),
          );
        } catch (cognitoErr: unknown) {
          const errType = (cognitoErr as { __type?: string }).__type;
          if (errType === 'UsernameExistsException') {
            await cognitoClient.send(
              new AdminDeleteUserCommand({
                UserPoolId: COGNITO_USER_POOL_ID,
                Username: email,
              }),
            );
            await cognitoClient.send(
              new AdminCreateUserCommand({
                UserPoolId: COGNITO_USER_POOL_ID,
                Username: email,
                TemporaryPassword: tempPassword,
                UserAttributes: [
                  { Name: 'email', Value: email },
                  { Name: 'email_verified', Value: 'true' },
                ],
                DesiredDeliveryMediums: ['EMAIL'],
              }),
            );
          } else {
            throw cognitoErr;
          }
        }
      } catch (err) {
        // Roll back AuthUser changes if Cognito call fails unrecoverably
        if (!existingAuthUser) {
          await prisma.authUser.delete({ where: { email } }).catch(() => {});
        }
        throw err;
      }
    } else {
      logger.warn(
        { email },
        'InvitationService.createInvitation: Cognito is not configured — no invitation email was sent. Set COGNITO_USER_POOL_ID (or COGNITO_ISSUER) in your environment to enable email delivery.',
      );
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

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.authUser.upsert({
      where: { email: invitation.email },
      update: { passwordHash },
      create: { email: invitation.email, passwordHash, isSuperAdmin: false },
    });

    if (isCognitoConfigured()) {
      try {
        const cognitoClient = getCognitoClient();
        try {
          await cognitoClient.send(
            new AdminDeleteUserCommand({
              UserPoolId: COGNITO_USER_POOL_ID,
              Username: invitation.email,
            }),
          );
        } catch {
          // User may not exist in Cognito — continue to create
        }
        await cognitoClient.send(
          new AdminCreateUserCommand({
            UserPoolId: COGNITO_USER_POOL_ID,
            Username: invitation.email,
            TemporaryPassword: tempPassword,
            UserAttributes: [
              { Name: 'email', Value: invitation.email },
              { Name: 'email_verified', Value: 'true' },
            ],
            DesiredDeliveryMediums: ['EMAIL'],
          }),
        );
      } catch (err) {
        logger.error({ err }, 'InvitationService.resendInvitation: Cognito error');
        throw new Error('Failed to resend invitation via Cognito');
      }
    } else {
      logger.warn(
        { email: invitation.email },
        'InvitationService.resendInvitation: Cognito is not configured — no email was resent.',
      );
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

    if (isCognitoConfigured()) {
      try {
        await getCognitoClient().send(
          new AdminDisableUserCommand({
            UserPoolId: COGNITO_USER_POOL_ID,
            Username: invitation.email,
          }),
        );
      } catch (err: unknown) {
        logger.warn(
          { err, email: invitation.email },
          'InvitationService.revokeInvitation: AdminDisableUser failed',
        );
      }
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
        logger.error(
          { err, invitationId: invitation.id },
          'InvitationService.acceptPendingInvitation: failed',
        );
      }
    }
  }
}
