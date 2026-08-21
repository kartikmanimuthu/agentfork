/**
 * dashboard-service.ts — read-only aggregation for the Mission Dashboard.
 *
 * Every query is tenant-scoped explicitly (matching skill-service / memory-service
 * convention) and read-only: no writes, no raw SQL. Raw SQL is deliberately avoided
 * because it bypasses the tenant middleware — which is also why memory embedding
 * health is NOT in Phase 1 (`embedding` is an Unsupported column Prisma cannot
 * filter on at all).
 */

import { getPrismaClient, createLogger } from '@chatbot/shared';
import { getConnectorRegistry } from '../connectors/registry';
import { ClawConnectorConfigService } from '../connectors/config-service';
import {
  DEFAULT_DASHBOARD_RANGE,
  EXPIRING_SOON_DAYS,
  RANGE_DAYS,
  TREND_ROW_CAP,
  type ActivityZone,
  type AttentionZone,
  type DashboardPayload,
  type DashboardRange,
  type HeroZone,
  type MemoryZone,
  type ReadinessZone,
  type ZoneResult,
} from './types';

const logger = createLogger('claw-studio:dashboard');

function sinceFor(range: DashboardRange): Date {
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000);
}

/** Counts the tenant's connectors that are configured, and how many are switched on. */
async function connectorCounts(tenantId: string): Promise<{ configured: number; enabled: number }> {
  const configs = new ClawConnectorConfigService(tenantId);
  let configured = 0;
  let enabled = 0;
  for (const connector of getConnectorRegistry().list()) {
    try {
      const masked = await configs.getMasked(connector.channelType);
      if (masked.configured) configured += 1;
      if (masked.enabled) enabled += 1;
    } catch (error) {
      // A channel whose secret can't be decrypted (e.g. no ENCRYPTION_KEY) must
      // not take down the zone — treat it as unconfigured, same as the
      // connectors list route does.
      logger.warn({ error, tenantId, channel: connector.channelType }, 'Connector status unreadable');
    }
  }
  return { configured, enabled };
}

export async function getHeroZone(tenantId: string): Promise<HeroZone> {
  const db = getPrismaClient();
  const [memories, skillsEnabled, skillsTotal, activeTools, provider] = await Promise.all([
    db.clawMemory.count({ where: { tenantId } }),
    db.clawSkill.count({ where: { tenantId, isEnabled: true } }),
    db.clawSkill.count({ where: { tenantId } }),
    db.mcpServer.count({ where: { tenantId, status: 'active' } }),
    db.llmProvider.findFirst({
      where: { tenantId, isDefault: true },
      select: { name: true, providerType: true, chatModel: true },
    }),
  ]);
  return { memories, skillsEnabled, skillsTotal, activeTools, provider };
}

export async function getReadinessZone(tenantId: string): Promise<ReadinessZone> {
  const db = getPrismaClient();
  const [provider, skills, tools, connectors] = await Promise.all([
    db.llmProvider.count({ where: { tenantId, isDefault: true } }),
    db.clawSkill.count({ where: { tenantId, isEnabled: true } }),
    db.mcpServer.count({ where: { tenantId, status: 'active' } }),
    connectorCounts(tenantId),
  ]);

  const items = [
    {
      id: 'provider',
      label: 'Default LLM provider',
      done: provider > 0,
      hint: 'Claw cannot answer without a model. Configure one.',
      href: '/llm-providers',
    },
    {
      id: 'skills',
      label: 'At least one skill enabled',
      done: skills > 0,
      hint: 'Skills teach Claw repeatable procedures.',
      href: '/skills',
    },
    {
      id: 'tools',
      label: 'An MCP tool server connected',
      done: tools > 0,
      hint: 'MCP servers give Claw tools it can call.',
      href: '/mcp',
    },
    {
      id: 'connectors',
      label: 'A channel connector enabled',
      done: connectors.enabled > 0,
      hint: 'Connect Slack or Telegram to reach Claw outside this console.',
      href: '/connectors',
    },
  ];

  return { items, completed: items.filter((i) => i.done).length, total: items.length };
}

export async function getMemoryZone(tenantId: string, range: DashboardRange): Promise<MemoryZone> {
  const db = getPrismaClient();
  const since = sinceFor(range);

  const [total, byKindRaw, topRaw, trendRows] = await Promise.all([
    db.clawMemory.count({ where: { tenantId } }),
    db.clawMemory.groupBy({ by: ['kind'], where: { tenantId }, _count: true }),
    db.clawMemory.findMany({
      where: { tenantId },
      orderBy: { accessCount: 'desc' },
      take: 5,
      select: { id: true, key: true, kind: true, accessCount: true },
    }),
    db.clawMemory.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true },
      // Explicit, disclosed cap — see TREND_ROW_CAP.
      take: TREND_ROW_CAP,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const byKind = byKindRaw
    .map((row) => ({ kind: String(row.kind), count: Number(row._count) }))
    .sort((a, b) => b.count - a.count);

  const days = new Map<string, number>();
  for (const row of trendRows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const writeTrend = [...days.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    total,
    byKind,
    topAccessed: topRaw.map((m) => ({
      id: m.id,
      key: m.key,
      kind: String(m.kind),
      accessCount: m.accessCount,
    })),
    writeTrend,
    truncated: trendRows.length >= TREND_ROW_CAP,
  };
}

export async function getAttentionZone(tenantId: string, range: DashboardRange): Promise<AttentionZone> {
  const db = getPrismaClient();
  const soon = new Date(Date.now() + EXPIRING_SOON_DAYS * 86_400_000);
  const since = sinceFor(range);

  const [expiring, erroredTools, systemSkills, pendingApprovals, failedRuns, pausedTasks] = await Promise.all([
    db.clawMemory.count({ where: { tenantId, expiresAt: { lte: soon } } }),
    db.mcpServer.count({ where: { tenantId, status: 'error' } }),
    db.clawSkill.count({ where: { tenantId, source: 'system' } }),
    // Current state, not range-bound: a run stuck waiting on a human is exactly
    // as urgent regardless of when it started.
    db.clawRun.count({ where: { tenantId, status: 'awaiting_approval' } }),
    db.clawRun.count({ where: { tenantId, status: 'failed', createdAt: { gte: since } } }),
    // Also current state — failureStreak auto-pauses a task at 3 (see
    // libs/claw-studio/CLAUDE.md), so a paused task stays a live problem
    // until someone looks at it, not something that ages out.
    db.clawScheduledTask.count({ where: { tenantId, status: 'paused' } }),
  ]);

  const groups = [
    {
      id: 'pending-approvals',
      label: 'Runs waiting on your approval',
      count: pendingApprovals,
      emptyCopy: 'No runs waiting on you.',
      href: '/runs',
    },
    {
      id: 'failed-runs',
      label: `Failed runs in the last ${RANGE_DAYS[range]} days`,
      count: failedRuns,
      emptyCopy: 'No failed runs in range.',
      href: '/runs',
    },
    {
      id: 'paused-tasks',
      label: 'Scheduled tasks paused after repeated failures',
      count: pausedTasks,
      emptyCopy: 'No scheduled tasks paused.',
      href: '/scheduled-tasks',
    },
    {
      id: 'expiring-memories',
      label: `Memories expiring within ${EXPIRING_SOON_DAYS} days`,
      count: expiring,
      emptyCopy: 'Nothing expiring soon.',
      href: '/memory',
    },
    {
      id: 'errored-tools',
      label: 'MCP servers reporting errors',
      count: erroredTools,
      emptyCopy: 'All tool servers healthy.',
      href: '/mcp',
    },
    {
      id: 'system-skills',
      label: 'Auto-created skills to review',
      count: systemSkills,
      emptyCopy: 'No auto-created skills awaiting review.',
      href: '/skills',
    },
  ];

  return { groups, total: groups.reduce((sum, g) => sum + g.count, 0) };
}

export async function getActivityZone(tenantId: string, range: DashboardRange): Promise<ActivityZone> {
  const db = getPrismaClient();
  const since = sinceFor(range);

  const [recentRaw, bySeverityRaw] = await Promise.all([
    db.auditLog.findMany({
      where: { tenantId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        eventType: true,
        action: true,
        severity: true,
        status: true,
        userId: true,
        createdAt: true,
      },
    }),
    db.auditLog.groupBy({
      by: ['severity'],
      where: { tenantId, createdAt: { gte: since } },
      _count: true,
    }),
  ]);

  return {
    recent: recentRaw.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      action: r.action,
      severity: r.severity,
      status: r.status,
      user: r.userId ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    bySeverity: bySeverityRaw
      .map((row) => ({ severity: String(row.severity), count: Number(row._count) }))
      .sort((a, b) => b.count - a.count),
  };
}

function settle<T>(result: PromiseSettledResult<T>, zone: string, tenantId: string): ZoneResult<T> {
  if (result.status === 'fulfilled') return { ok: true, data: result.value };
  logger.error({ error: result.reason, tenantId, zone }, 'Dashboard zone failed');
  return { ok: false, error: `Failed to load ${zone}` };
}

/**
 * Builds the whole payload. Uses allSettled so a single failing zone reports its
 * own error while every other card still renders.
 */
export async function getDashboard(
  tenantId: string,
  range: DashboardRange = DEFAULT_DASHBOARD_RANGE,
): Promise<DashboardPayload> {
  const [hero, readiness, memory, attention, activity] = await Promise.allSettled([
    getHeroZone(tenantId),
    getReadinessZone(tenantId),
    getMemoryZone(tenantId, range),
    getAttentionZone(tenantId, range),
    getActivityZone(tenantId, range),
  ]);

  return {
    range,
    generatedAt: new Date().toISOString(),
    hero: settle(hero, 'hero', tenantId),
    readiness: settle(readiness, 'readiness', tenantId),
    memory: settle(memory, 'memory', tenantId),
    attention: settle(attention, 'attention', tenantId),
    activity: settle(activity, 'activity', tenantId),
  };
}
