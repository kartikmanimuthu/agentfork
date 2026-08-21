/**
 * claw-resolver.ts — resolves the signed-in studio's tenant + Claw.
 *
 * Mission Control has its OWN NextAuth Credentials login (Studio ID + password);
 * middleware.ts is explicit that it does not trust web-ui's session. The JWT puts
 * the ids under `session.studio`, not `session.user`.
 */

import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:claw-resolver');

export class UnauthenticatedError extends Error {
  constructor() {
    super('Unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}

export class ClawNotProvisionedError extends Error {
  constructor() {
    super('No Claw provisioned for this tenant');
    this.name = 'ClawNotProvisionedError';
  }
}

export interface ResolvedClaw {
  tenantId: string;
  clawId: string;
}

export async function resolveClawForSession(): Promise<ResolvedClaw> {
  const session = await getServerSession(authOptions);
  const tenantId = session?.studio?.tenantId;
  if (!tenantId) throw new UnauthenticatedError();

  // clawId is already on the session; the lookup is a fallback for older tokens
  // minted before it was added.
  if (session.studio.clawId) return { tenantId, clawId: session.studio.clawId };

  try {
    const studio = await getPrismaClient().clawStudio.findFirst({
      where: { tenantId },
      include: { claws: true },
    });
    const clawId = studio?.claws[0]?.id;
    if (!clawId) throw new ClawNotProvisionedError();
    return { tenantId, clawId };
  } catch (error) {
    logger.error({ error, tenantId }, 'Failed to resolve Claw for session');
    throw error;
  }
}
