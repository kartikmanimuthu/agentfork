/**
 * channel-link.ts — reverse lookup from a platform-native identifier to a tenant.
 *
 * Inbound webhooks never carry our tenant id, and per the design reference (§4)
 * the tenant must be resolved from something the *platform* sent, never from a
 * header or query param the caller controls. Otherwise anyone who learns a
 * tenant id can drive that tenant's Claw.
 *
 *   slack    → externalId = team_id, read from the signed inbound payload
 *   telegram → externalId = sha256(secretToken); a Telegram webhook carries no
 *              workspace/bot identifier at all, so the shared secret in
 *              `x-telegram-bot-api-secret-token` is the only tenant-identifying
 *              value available. Hashing means a leaked link row does not leak
 *              the secret itself.
 */

import crypto from 'crypto';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import type { ChannelType } from '../connectors/types';

const logger = createLogger('claw-studio:gateway:channel-link');

/** Stable, non-reversible id for a shared secret. */
export function hashExternalId(value: string): string {
  return crypto.createHash('sha256').update(value.trim()).digest('hex');
}

export interface ChannelLink {
  channel: string;
  externalId: string;
  tenantId: string;
  label: string | null;
}

/**
 * Points `channel:externalId` at `tenantId`, taking the mapping over from
 * another tenant if it already existed — re-installing a Slack workspace under a
 * new tenant has to work, and the upsert is keyed on the platform id precisely
 * so two tenants can never both claim it.
 */
export async function linkChannel(input: {
  channel: ChannelType;
  externalId: string;
  tenantId: string;
  label?: string;
}): Promise<void> {
  const db = getPrismaClient();
  try {
    await db.clawChannelLink.upsert({
      where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
      create: {
        channel: input.channel,
        externalId: input.externalId,
        tenantId: input.tenantId,
        label: input.label ?? null,
      },
      update: { tenantId: input.tenantId, label: input.label ?? null },
    });
    logger.info({ channel: input.channel, tenantId: input.tenantId }, 'Channel link upserted');
  } catch (error) {
    logger.error({ error, channel: input.channel, tenantId: input.tenantId }, 'Failed to upsert channel link');
    throw error;
  }
}

export async function resolveTenantByExternalId(
  channel: ChannelType,
  externalId: string,
): Promise<string | null> {
  const db = getPrismaClient();
  try {
    const row = await db.clawChannelLink.findUnique({
      where: { channel_externalId: { channel, externalId } },
      select: { tenantId: true },
    });
    if (!row) {
      logger.warn({ channel }, 'No tenant linked for inbound external id');
      return null;
    }
    return row.tenantId;
  } catch (error) {
    logger.error({ error, channel }, 'Failed to resolve tenant from channel link');
    return null;
  }
}

export async function listChannelLinks(tenantId: string, channel?: ChannelType): Promise<ChannelLink[]> {
  const db = getPrismaClient();
  try {
    const rows = await db.clawChannelLink.findMany({
      where: { tenantId, ...(channel ? { channel } : {}) },
      select: { channel: true, externalId: true, tenantId: true, label: true },
    });
    return rows;
  } catch (error) {
    logger.error({ error, tenantId }, 'Failed to list channel links');
    return [];
  }
}

/**
 * Drops a channel's links for one tenant. Called on connector reset so a stale
 * mapping can't misroute a future workspace's requests into this tenant
 * (design reference §6).
 */
export async function unlinkChannel(tenantId: string, channel: ChannelType): Promise<number> {
  const db = getPrismaClient();
  try {
    const { count } = await db.clawChannelLink.deleteMany({ where: { tenantId, channel } });
    logger.info({ tenantId, channel, count }, 'Channel links removed');
    return count;
  } catch (error) {
    logger.error({ error, tenantId, channel }, 'Failed to remove channel links');
    throw error;
  }
}
