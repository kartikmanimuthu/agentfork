/**
 * types.ts — Mission Dashboard payload shapes.
 *
 * See docs/superpowers/plans/2026-07-28-mission-dashboard-design.md. Phase 1 covered
 * only what existing data could honestly support: current-state counts, memory
 * composition, and an audit list. It deliberately excluded anything needing a
 * persisted run/event model — that model (`ClawRun`, `ClawScheduledTask`) exists
 * now, so `AttentionZone` also covers pending approvals, recent failed runs, and
 * scheduled tasks auto-paused by a failure streak (see getAttentionZone).
 */

export type DashboardRange = '7d' | '30d' | '90d';

export const DASHBOARD_RANGES: DashboardRange[] = ['7d', '30d', '90d'];
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '30d';

export const RANGE_DAYS: Record<DashboardRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Memories are TTL'd; this is the lookahead for the "expiring soon" warning. */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Explicit row cap for the one query that reads rows rather than counting them.
 * The design doc calls out nucleus's silent `take: 10000` caps as a defect, so
 * this one is surfaced to the UI via `truncated`.
 */
export const TREND_ROW_CAP = 5000;

// ============================================================================
// Zones
// ============================================================================

export interface HeroZone {
  memories: number;
  skillsEnabled: number;
  skillsTotal: number;
  activeTools: number;
  /** Null when no default LLM provider is configured — rendered as "not configured". */
  provider: { name: string; providerType: string; chatModel: string | null } | null;
}

export interface ReadinessItem {
  id: string;
  label: string;
  done: boolean;
  /** What to do about it when not done. */
  hint: string;
  href: string;
}

export interface ReadinessZone {
  items: ReadinessItem[];
  completed: number;
  total: number;
}

export interface MemoryKindCount {
  kind: string;
  count: number;
}

export interface TopMemory {
  id: string;
  key: string;
  kind: string;
  accessCount: number;
}

export interface TrendPoint {
  /** `YYYY-MM-DD`, sortable. Days with no writes are omitted. */
  day: string;
  count: number;
}

export interface MemoryZone {
  total: number;
  byKind: MemoryKindCount[];
  topAccessed: TopMemory[];
  writeTrend: TrendPoint[];
  /** True when the trend hit TREND_ROW_CAP — the chart is then incomplete. */
  truncated: boolean;
}

export interface AttentionGroup {
  id: string;
  label: string;
  count: number;
  /** Shown when count is 0 — names the next action rather than reading as a bare zero. */
  emptyCopy: string;
  href: string;
}

export interface AttentionZone {
  groups: AttentionGroup[];
  total: number;
}

export interface AuditEntry {
  id: string;
  eventType: string;
  action: string;
  severity: string;
  status: string;
  user: string | null;
  createdAt: string;
}

export interface ActivityZone {
  recent: AuditEntry[];
  bySeverity: { severity: string; count: number }[];
}

// ============================================================================
// Envelope
// ============================================================================

/**
 * Per-zone success/failure so one broken query degrades a single card instead of
 * the page — the design doc's "zone independence" principle, achieved in one
 * round trip rather than nucleus's request-per-zone.
 */
export type ZoneResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DashboardPayload {
  range: DashboardRange;
  generatedAt: string;
  hero: ZoneResult<HeroZone>;
  readiness: ZoneResult<ReadinessZone>;
  memory: ZoneResult<MemoryZone>;
  attention: ZoneResult<AttentionZone>;
  activity: ZoneResult<ActivityZone>;
}
