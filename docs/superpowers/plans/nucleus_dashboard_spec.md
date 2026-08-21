# Dashboard ("Mission Control") — Complete Replication Spec

Everything the `/app/dashboard` page renders, where each number comes from, and how to
rebuild it from scratch. Reflects the code as of branch `master-v1`.

Related: [`dashboard-refactor-plan.md`](./dashboard-refactor-plan.md) (design intent),
[`dashboard-wireframes.md`](./dashboard-wireframes.md) (layout sketches). This document is
the *implementation* reference — the two above are the plan.

---

## 1. File inventory

Everything involved, in dependency order. To replicate the dashboard you need exactly these
9 files (plus the shared UI primitives and Prisma models listed in §7 / §8).

| Layer | File | LOC | Role |
| --- | --- | --- | --- |
| Route | `apps/web-ui/app/app/dashboard/page.tsx` | 11 | Server component; auth gate → renders shell |
| Shell | `apps/web-ui/components/dashboard/dashboard-shell.tsx` | 71 | Owns time-range state, renders 7 zones in a grid |
| Zone | `apps/web-ui/components/dashboard/hero-kpis-section.tsx` | 131 | 6 KPI cards + sparklines |
| Zone | `apps/web-ui/components/dashboard/action-center-section.tsx` | 116 | Triage feed of things needing attention |
| Zone | `apps/web-ui/components/dashboard/coverage-section.tsx` | 122 | Account sync health |
| Zone | `apps/web-ui/components/dashboard/cost-automation-section.tsx` | 113 | Savings + schedule executions |
| Zone | `apps/web-ui/components/dashboard/agent-activity-section.tsx` | 134 | AI Ops runs, tools, approvals |
| Zone | `apps/web-ui/components/dashboard/inventory-snapshot-section.tsx` | 139 | Resource counts by type/status/account |
| Zone | `apps/web-ui/components/dashboard/audit-snapshot-section.tsx` | 135 | Security/audit events |
| Query hooks | `apps/web-ui/lib/queries/dashboard.ts` | 64 | 7 TanStack Query hooks, one per zone |
| Query keys | `apps/web-ui/lib/queries/query-keys.ts` (lines 103–112) | — | `queryKeys.dashboard.*` factory |
| Client fetch | `apps/web-ui/lib/client-dashboard-service.ts` | 71 | Typed wrapper over `GET /api/dashboard` |
| Types | `apps/web-ui/lib/dashboard-types.ts` | 352 | All zone response types + time-range helpers |
| API route | `apps/web-ui/app/api/dashboard/route.ts` | 75 | Single consolidated endpoint, `?zone=&range=` |
| Service | `apps/web-ui/lib/dashboard-service.ts` | 86 | Thin pass-through to the repository |
| Repo interface | `apps/web-ui/lib/db/repositories/dashboard/interface.ts` | 49 | `IDashboardRepository` contract |
| Repo impl | `apps/web-ui/lib/db/repositories/dashboard/postgres.ts` | 1160 | All Prisma queries + aggregation (zones start at line 584) |
| Factory | `apps/web-ui/lib/db/repository-factory.ts` (line 141) | — | `getDashboardRepository()` |

---

## 2. Request flow

```
Browser
  └─ /app/dashboard  (Next.js server component)
       ├─ getAuthSession() → redirect to /api/auth/signin if no session
       └─ <DashboardShell>                       'use client'
            ├─ useState<TimeRange>('24h')        ← global range selector
            └─ 7 zone components, each calling one hook:
                 useDashboardHero(range)          → queryKeys.dashboard.hero(range)
                 useDashboardActionCenter(range)  → …actionCenter(range)
                 useDashboardCoverage()           → …coverage()          [range-independent]
                 useDashboardCostAutomation(range)→ …costAutomation(range)
                 useDashboardAgentActivity(range) → …agentActivity(range)
                 useDashboardInventory()          → …inventory()         [range-independent]
                 useDashboardAudit(range)         → …audit(range)
                      │
                      └─ ClientDashboardService.fetchZone(zone, range)
                           └─ GET /api/dashboard?zone=<zone>&range=<range>   cache: 'no-store'
                                ├─ authorize('read', 'Dashboard')  → 403 NextResponse or null
                                ├─ getSessionTenantId()
                                ├─ validate zone ∈ 7 values (400), range ∈ 4 values (400)
                                └─ DashboardService.get<Zone>(tenantId, range)
                                     └─ DashboardPostgresRepository.get<Zone>()
                                          └─ getTenantClient(tenantId)  ← auto WHERE tenant_id
                                               └─ Prisma queries (Promise.all per zone)
```

**Key architectural decisions to preserve when replicating:**

1. **One endpoint, seven zones.** `?zone=` selects the metric bucket. Not seven routes.
2. **Per-zone caching.** Each zone has its own query key, so changing the range refetches
   only the 5 range-dependent zones; Coverage and Inventory stay cached.
3. **Zone independence.** Zones render, load, error, and skeleton *independently* — one
   failing zone shows an inline red card while the rest of the page works.
4. **No client-side aggregation.** Every number arrives pre-computed from the repository.
   Components only format (`toLocaleString`, `%`, `$`) and compute bar heights.
5. **Server-side aggregation is in-process, not SQL.** The repository does `findMany` +
   JS `Map` reduction rather than `GROUP BY`. Simple, but see the caveats in §9.

---

## 3. Layout

`dashboard-shell.tsx` — outer wrapper `space-y-6 p-4 md:p-6`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mission Control                                    [ Last 24 hours  ▾ ]  │  header row
│ Real-time health of your cloud operations.                               │  flex-col → sm:flex-row
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐                         │  HERO KPIS
│ │Savngs││Sched ││Accts ││Agent ││Pend  ││Crit  │                         │  grid-cols-1
│ │      ││Succss││Synced││Runs  ││Apprvl││Events│                         │  sm:grid-cols-2
│ └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘                         │  lg:grid-cols-3
│                                                                          │  xl:grid-cols-6
├────────────────────────────────────┬─────────────────────────────────────┤
│  Action Center                 [n] │  Account Coverage                   │  grid lg:grid-cols-2
├────────────────────────────────────┼─────────────────────────────────────┤
│  Cost & Automation                 │  Agent Activity        [n pending]  │  grid lg:grid-cols-2
├────────────────────────────────────┼─────────────────────────────────────┤
│  Inventory Snapshot                │  Security & Audit     [n critical]  │  grid lg:grid-cols-2
└────────────────────────────────────┴─────────────────────────────────────┘
```

Grid gaps: `gap-4` for the hero row, `gap-6` for the three two-column rows.
All zone cards use `<Card className="flex flex-col">` with `<CardContent className="flex-1">`
so paired cards in a row stretch to equal height.

### Time-range selector

Radix `Select`, `w-[180px]`, default `'24h'`. Four options only:

| Value | Label | Sparkline/trend bucket |
| --- | --- | --- |
| `24h` | Last 24 hours | 1 hour (`HH:00`) |
| `7d` | Last 7 days | 1 day (`MMM dd`) |
| `30d` | Last 30 days | 1 day (`MMM dd`) |
| `90d` | Last 90 days | 1 week, Sunday-anchored (`MMM dd`) |

The range is **client state only** — not a URL param, not persisted. Reloading the page
resets to `24h`.

---

## 4. Zone-by-zone specification

### 4.1 Hero KPIs — `zone=hero`

Six cards, fixed order and fixed IDs. Each card is a `<Link>` wrapping a `<Card>`, with
`hover:scale-[1.01]`.

Card anatomy:
- Uppercase `text-xs` muted label
- `text-2xl font-semibold` formatted value
- Icon in a `rounded-md bg-muted p-2` box (top-right)
- Delta row: arrow icon + `{delta}%` + "vs previous period"
- Sparkline: 7 flex-1 divs, `h-8` container, height `max((value/max)*100, 8)%`

**Delta coloring is semantic, not directional.** Each card carries `higherIsBetter`;
green when the direction is *good*, red when *bad*, slate when neutral:

```
isPositive = (higherIsBetter && direction==='up') || (!higherIsBetter && direction==='down')
isNegative = (higherIsBetter && direction==='down') || (!higherIsBetter && direction==='up')
```

Sparkline bar color follows the same flag: `bg-emerald-500/20` when positive, else `bg-blue-500/20`.

| id | Label | Value | higherIsBetter | Icon | Sparkline | href |
| --- | --- | --- | --- | --- | --- | --- |
| `savings` | Est. Savings | `Σ resourcesStopped × $0.10` | ✅ | `PiggyBankIcon` | 7 buckets | `/schedules?tab=executions` |
| `schedule-success` | Schedule Success | `success execs / total execs` as % | ✅ | `CheckCircleIcon` | — | `/schedules?status=failed` |
| `accounts-synced` | Accounts Synced | count active + connected accounts | ✅ | `ServerIcon` | — | `/accounts?filter=stale` |
| `agent-runs` | Agent Runs | count `AgentOpsRun` in range | ❌ | `BotIcon` | — | `/agent-ops?range=24h` |
| `agent-approvals` | Pending Approvals | count runs `status='awaiting_approval'` | ❌ | `ClockIcon` | — | `/agent-ops?status=awaiting_approval` |
| `critical-events` | Critical Events | count `AuditLog severity='critical'` | ❌ | `ShieldAlertIcon` | — | `/audit-logs?severity=critical` |

Only `savings` has a sparkline; the other five ship `sparkline: []` and render no bar strip.

**Icon resolution** goes through `ICON_MAP` in the component, keyed by `card.icon` (the API
sends `'savings'`, `'success-rate'`, `'accounts'`, `'agent-runs'`, `'approvals'`,
`'audit-events'`). The map also contains legacy aliases equal to the card IDs
(`schedule-success`, `accounts-synced`, `agent-approvals`, `critical-events`).
Fallback: `ServerIcon`.

**Queries** (10 in one `Promise.all`):

```ts
scheduleExecution.findMany({ executionTime >= since })                       // current
scheduleExecution.findMany({ executionTime in [prev.start, prev.end) })      // previous
account.count({ active: true, connectionStatus: 'connected' })
account.count({ active, connected, createdAt < since })                      // previous
agentOpsRun.count({ createdAt >= since })            + previous-period count
auditLog.count({ timestamp >= since })               + previous-period count
auditLog.count({ timestamp >= since, severity: 'critical' })
agentOpsRun.count({ status: 'awaiting_approval', createdAt >= since })
```

Note: `auditLogs` / `prevAuditLogs` are fetched but never used in a card — dead weight, safe
to drop in a reimplementation. `critical-events` calls `computeDelta(criticalAuditLogs, 0)`,
which always returns `{delta: 0, direction: 'neutral'}` because `computeDelta` short-circuits
when `previous === 0`. `agent-approvals` hardcodes a zero delta.

**Savings sparkline algorithm:**

```ts
const buckets = 7;
const bucketDuration = (Date.now() - since) / buckets;
for (const exec of executions) {
  const idx = min(floor((exec.executionTime - since) / bucketDuration), buckets - 1);
  if (idx >= 0) sparkline[idx] += exec.resourcesStopped * 0.10;
}
```

Fixed 7 buckets regardless of range — for `24h` that's ~3.4h per bar, for `90d` ~12.8 days.

**Skeleton:** 6 × `KpiSkeleton` (label 3×20, value 7×24, 9×9 icon square, 3×28 delta, 8×full sparkline).
**Error:** replaces the whole section with a red bordered/bg box: "Failed to load KPIs: {message}".

---

### 4.2 Action Center — `zone=action-center`

The triage queue. Header shows a destructive `Badge` with the **sum of all four counts**
when > 0. Empty state: centered muted "No items need attention."

Four item groups render in fixed order with per-group slice caps — **max 9 rows**:

| Group | Cap | Icon | Hover tint | Primary text | Secondary text |
| --- | --- | --- | --- | --- | --- |
| `failingExecutions` | 3 | `AlertTriangleIcon` amber | amber | `{scheduleName} {action} failed` | `{accountName} • {failedAt}` |
| `pendingAgentApprovals` | 2 | `BotIcon` blue | blue | `Approval requested: {taskName}` | `{requestedAt}` |
| `accountsWithErrors` | 2 | `CloudOffIcon` red | red | `{name}` | `{error}` |
| `criticalEvents` | 2 | `ShieldAlertIcon` red | red | `{eventType}` | `{message}` |

Each row is a `<Link href={item.href}>` with `border-transparent` → colored border+bg on hover
(light and dark variants). Timestamps use `new Date(x).toLocaleString()`.

**The badge count and the visible rows disagree by design.** `counts.*` reflects the DB fetch
(capped at `take: 10` each, so max 40), while the UI shows at most 9. A tenant with 10 failing
executions sees a badge of "10+" worth of work but only 3 rows.

**Queries** (5 in `Promise.all`, each `take: 10`):

```ts
scheduleExecution.findMany({ executionTime >= since, status: 'failed' }, orderBy: executionTime desc)
agentOpsRun.findMany({ status: 'awaiting_approval', createdAt >= since }, orderBy: createdAt desc)
account.findMany({ active: true, connectionStatus: { not: 'connected' } })
auditLog.findMany({ timestamp >= since, severity: { in: ['critical','high'] } }, orderBy: timestamp desc)
account.findMany({ select: { accountId, name } })   // full list, for the name lookup Map
```

**Derived fields:**
- `action`: `resourcesStopped > 0 ? 'stop' : 'start'` — inferred, not stored
- `scheduleName`: **set to `exec.scheduleId`**, not the human name (see §9)
- `accountName`: `accountMap.get(accountId) ?? accountId`
- `reason`: `errorMessage ?? 'Execution failed'`
- `taskName`: `taskDescription ?? 'Agent run'`
- `error` (accounts): the literal string `` `Connection status: ${connectionStatus}` ``
- `requesterName`: always `null` — the field exists in the type but is never populated

---

### 4.3 Account Coverage — `zone=coverage`

**Range-independent** — always the current state.

Three stacked blocks:

1. **Healthy-accounts progress bar.** `"Healthy accounts"` / `{connected}/{total}` +
   `<Progress value={round(connected/total*100)} className="h-2" />`.
2. **4-cell status grid** (`grid-cols-4`, bordered cells, `text-lg` count over a
   `text-[10px] uppercase` label): connected / stale / disconnected / never.
3. **Account list** — first 6 accounts, each a `<Link>` in a `max-h-[180px] overflow-y-auto`
   scroller. Row is fully tinted by status via `statusClass()`, with a status icon and the
   status word repeated on the right at `text-xs opacity-80`.

**Status derivation** (`computeStatus`, threshold `STALE_SYNC_THRESHOLD_HOURS = 24`):

```ts
if (connectionStatus !== 'connected') return 'disconnected';
if (!lastSyncedAt)                    return 'never';
if (now - lastSyncedAt > 24h)         return 'stale';
return 'connected';
```

| Status | Icon | Palette |
| --- | --- | --- |
| `connected` | `CheckCircleIcon` | emerald-50/700/200, dark emerald-950/30 |
| `stale` | `AlertCircleIcon` | amber-50/700/200, dark amber-950/30 |
| `disconnected` | `XCircleIcon` | red-50/700/200, dark red-950/30 |
| `never` | `HelpCircleIcon` | slate-50/600/200, dark slate-900 |

**Queries:**
```ts
account.findMany({ select: { id, accountId, name, connectionStatus, lastSyncedAt } })
inventorySyncStatus.findFirst({ where: { tenantId }, orderBy: { syncedAt: 'desc' } })
```

`lastScanAt` and `accountsSynced` come from that latest sync row but the component doesn't
render them — they're available for reuse. `href` is `/accounts/{accountId}`.
Note `inventorySyncStatus` is **explicitly** filtered by `tenantId` in the `where` even though
`getTenantClient` would add it; harmless, and the model's `tenantId` defaults to `""`.

---

### 4.4 Cost & Automation — `zone=cost-automation`

Three stacked blocks:

1. **3-cell summary grid**: Est. Savings (`$` emerald `text-lg`, 0 decimals) · Resources
   Optimized · Top Account (truncated name, `'N/A'` when empty).
2. **Savings Trend** bar strip — `h-16`, one `flex-1` bar per bucket, `bg-emerald-500/30`
   → `/50` on hover, `title` attribute = `` `${time}: $${savings.toFixed(2)}` ``, height
   `max((savings/maxSavings)*100, 4)%`. First and last bucket labels under the strip at
   `text-[10px]`. Hidden entirely when `trend.length === 0`.
3. **Recent Executions** — first 5, `max-h-[120px]` scroller. `PauseIcon` amber for `stop`,
   `PlayIcon` emerald for `start`; right side shows `$savings`, colored emerald when
   `status === 'success'` else red. Empty state: "No recent executions."

**The economic model is a flat constant.** `DEFAULT_HOURLY_COST = 0.10`:

```
savings = resourcesStopped × 0.10
```

A per-type `HOURLY_COST_MAP` exists in the repository (`EC2 0.10, RDS 0.15, ECS 0.08,
ASG 0.10, DocumentDB 0.12`) but **the zone methods never use it** — only the legacy methods
do. Every zone number treats every resource as $0.10/hr, and the unit is "per stop event",
not actually per hour. Treat "Est. Savings" as a proxy metric, not a dollar figure.

**Query:** a single `scheduleExecution.findMany({ executionTime >= since }, orderBy desc)`
plus `account.findMany` and `schedule.findMany` for the name maps. Then in JS:

- `trend`: bucket by `bucketTimestamp(executionTime, range)`, sum savings + resourcesStopped,
  sort by time string ascending
- `recentExecutions`: `executions.slice(0, 10)` (component then shows 5) — here
  `scheduleName` *is* resolved via `scheduleMap`
- `topAccount`: highest `accountSavings` entry
- `avgDailySavings`: `totalSavings / daysInRange` where `daysInRange` = 1 / 7 / 30 / 90
- `upcomingExecutions`: **hardcoded `[]`** with the comment "requires schedule recurrence
  parsing". The type and UI slot exist; the data never arrives.

---

### 4.5 Agent Activity — `zone=agent-activity`

Header badge: secondary `{pendingApprovals} pending` when > 0.

Four blocks:

1. **4-cell metric grid**: Runs · Success (%) · Scheduled · Avg ms.
2. **Runs by Source** — horizontal bars. Label `w-16 truncate capitalize`, track
   `h-2 rounded-full bg-muted`, fill `bg-blue-500` at `max(count/maxCount*100, 4)%`,
   count right-aligned `w-8`. Sources come from `AgentOpsRun.source`: `slack|jira|api|scheduled`.
3. **Top Tools** — first 6 as pill chips (`rounded-full border`), each `WrenchIcon` +
   truncated tool name (`max-w-[120px]`) + count.
4. **Approval Queue** — all returned items (≤10) in a `max-h-[100px]` scroller, each a
   `<Link>` to `/agent-ops/runs/{runId}` with `ClockIcon` amber and
   `toLocaleTimeString()` on the right.

Blocks 2–4 are each conditional on their array being non-empty.

**Queries:**
```ts
agentOpsRun.findMany({ createdAt >= since })                       // no take limit
agentOpsEvent.findMany({ createdAt >= since, eventType: 'tool_call' }, take: 10000)
scheduledTask.count({ taskStatus: 'active' })
agentOpsRun.findMany({ status: 'awaiting_approval', createdAt >= since }, take: 10, desc)
```

**Aggregation:**
- `bySource`: Map over runs; `successCount` increments when `status === 'completed'`
- `topTools`: Map over tool_call events by `toolName`, sorted desc, top 10.
  **`successCount` is never incremented** — `tool_call` events carry no outcome — so every
  tool reports `successRate: 0`. The UI wisely renders only `count`.
- `successRate`: `completedRuns / totalRuns × 100`, rounded
- `avgDurationMs`: mean `durationMs` over completed runs only, rounded. Rendered raw as a
  millisecond integer with no formatting — a 5-minute run displays as `300000`.

---

### 4.6 Inventory Snapshot — `zone=inventory`

**Range-independent.**

Four blocks:

1. **3-cell summary**: Total Resources · Accounts Synced · Last Scan
   (`toLocaleDateString()`, or `'Never'`).
2. **Status ribbon** — a horizontal flex of `h-2 rounded-full` segments, one per status,
   width `max(count/total*100, 2)%`, `title="{status}: {count}"`. Colors:
   Running emerald-500 · Stopped amber-500 · Terminated slate-400 · Pending blue-500 ·
   Other slate-300; unknown keys fall back to slate-300.
   Because each segment has a 2% floor and they're laid out with `gap-2`, the ribbon does not
   sum to exactly 100% width — it's indicative, not a true stacked bar.
3. **By Resource Type** — `grid-cols-2`, first 6 types, each a bordered cell with an icon +
   type name + `text-lg` count. `TYPE_ICONS`: EC2 `ServerIcon`, RDS `DatabaseIcon`,
   ECS `ContainerIcon`, ASG `LayersIcon`, DocumentDB `DatabaseIcon`, fallback `BoxIcon`.
4. **Top Accounts** — first 5 of the top-10 `byAccount`, `max-h-[120px]` scroller, linking to
   `/inventory?account={accountId}`.

**Queries:**
```ts
inventoryResource.findMany({ take: 10000, select: { resourceType, region, accountId, status, discoveredAt } })
account.findMany({ select: { accountId, name } })
inventorySyncStatus.findFirst({ where: { tenantId }, orderBy: { syncedAt: 'desc' } })
```

**Status normalization** (lowercased, then bucketed):

| Bucket | Raw statuses matched |
| --- | --- |
| Running | `running`, `available`, `active` |
| Stopped | `stopped`, `inactive` |
| Terminated | `terminated`, `deleted` |
| Pending | `pending`, `creating` |
| *(passthrough)* | anything else → bucketed under its own raw lowercase string, or `'Other'` if empty/null |

`other = total − running − stopped − terminated − pending`. `byRegion` is computed and
returned but **not rendered** by the current component. `newDiscovered` is hardcoded `0`
("requires comparison with previous scan").

The `take: 10000` cap is silent: a tenant with more than 10 000 resources gets an
undercounted, non-deterministically-sampled snapshot with no warning in the UI.

---

### 4.7 Security & Audit — `zone=audit`

Header badge: destructive `{criticalCount} critical` when > 0.

Four blocks:

1. **3-cell summary**: Total Events · Success Rate (%) · High Severity
   (= `criticalCount + highCount`, red).
2. **Open Findings by Severity** — pills in fixed `SEVERITY_ORDER`
   (`critical, high, medium, low`), each linking to `/audit-logs?severity={severity}`.
   Zero-count severities are skipped. Palettes: critical red-100/700, high orange-100/700,
   medium amber-100/700, low blue-100/700 (+ dark `*-950/40` variants).
3. **Error Trend** — `h-12` bar strip, `bg-red-500/30` → `/50` hover, height
   `max(error/maxError*100, 4)%`, `title="{time}: {error} errors"`.
4. **Top Event Types** — first 5 of top 10, plain bordered rows (no links), `max-h-[120px]`.

**Query:** one `auditLog.findMany({ timestamp >= since }, take: 5000, orderBy desc)`.

**Severity → timeline lane mapping** (note this is *severity*-driven, not status-driven):

```
critical | high  → error
medium           → warning
everything else  → success        ← includes 'low' and 'info'
```

So the "Error Trend" chart counts high-and-above events, and the `success` lane is a
catch-all that is never rendered anywhere. `successRate`, separately, *is* status-driven:
`logs.filter(status === 'success').length / logs.length`.

`openFindings` is a severity histogram of audit rows in the window — it is **not** a set of
open security findings in the vulnerability-management sense, despite the label.
Same 5000-row silent cap issue as inventory.

---

## 5. Shared conventions across all zones

Every zone component follows an identical three-state contract. Replicate this exactly:

```tsx
export function XSection({ range }: { range: TimeRange }) {
  const { data, isLoading, error } = useDashboardX(range);

  if (error) return (
    <Card><CardContent className="p-4 text-sm text-red-600">
      Failed to load X: {error.message}
    </CardContent></Card>
  );

  if (isLoading) return (
    <Card>
      <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-24 w-full" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </CardContent>
    </Card>
  );

  const summary = data?.summary;          // then every read is `?? fallback`
  ...
}
```

Other invariants:

- **Defensive defaults everywhere.** Even after the loading guard, every field is read with
  `?? 0` / `?? []` / `?? 'N/A'`.
- **Charts are pure CSS.** No Recharts on this page. Every bar is a `div` with an inline
  `style={{ height | width }}` percentage and a minimum floor (2–8%) so zero values stay
  visible. Tooltips are native `title` attributes.
- **Every row that represents a drillable entity is a `<Link>`** whose `href` is supplied by
  the server in the response payload (the `DashboardLink` mixin), never built in the component.
- **Scrollers** are `max-h-[100px|120px|180px] overflow-y-auto`.
- **Section labels** are `text-muted-foreground text-xs uppercase`.
- **Card titles** are `text-base font-semibold`; cards with a badge use
  `<CardHeader className="flex-row items-center justify-between pb-2">`.
- **Indentation is 4 spaces** in these files (per repo convention for lib/service-style code).

---

## 6. Time-range helper functions

All in `lib/dashboard-types.ts`. Replicate verbatim — every zone depends on them.

| Function | Behavior |
| --- | --- |
| `getTimeRangeDate(range)` | `now − {24h, 7d, 30d, 90d}` |
| `getPreviousPeriodDate(range)` | `{ start: since − duration, end: since }` — the immediately preceding equal-length window |
| `getTimeBucketFormat(range)` | `{ bucketMs, format }` — declared but unused by the zone code |
| `bucketTimestamp(date, range)` | `24h` → `YYYY-MM-DDTHH:00`; `90d` → Sunday-anchored `YYYY-MM-DD`; else `YYYY-MM-DD` |
| `computeDelta(current, previous)` | `{ delta: abs(round((c−p)/p×100)), deltaDirection }`; returns `{0, 'neutral'}` when `previous === 0` |

`bucketTimestamp` returns a **sortable string**, which is why trends are sorted with
`a.time.localeCompare(b.time)`. It uses local-time getters, so buckets are server-timezone
relative. Buckets with no data are absent from the array — the bar strips have no gaps for
empty periods, so a sparse 90-day trend renders as a dense strip of unevenly-spaced bars.

---

## 7. UI primitives used

All existing shadcn/Radix components in `apps/web-ui/components/ui/` — do not modify them:

`card` (Card, CardContent, CardHeader, CardTitle) · `select` (Select, SelectContent,
SelectItem, SelectTrigger, SelectValue) · `skeleton` · `badge` · `progress`

Plus: `next/link`, `cn()` from `@/lib/utils`, and lucide-react icons —
`ArrowDown/Up`, `Minus`, `PiggyBank`, `CheckCircle`, `Server`, `Bot`, `ShieldAlert`, `Clock`,
`AlertTriangle`, `CloudOff`, `AlertCircle`, `XCircle`, `HelpCircle`, `Play`, `Pause`,
`Wrench`, `Database`, `Container`, `Box`, `Layers`.

---

## 8. Data dependencies (Prisma models)

Nine models from `libs/prisma/schema.prisma`. Fields actually read by the dashboard:

| Model | Fields read | Used by |
| --- | --- | --- |
| `ScheduleExecution` | `scheduleId, accountId, status, executionTime, resourcesStarted, resourcesStopped, resourcesFailed, duration, errorMessage` | hero, action-center, cost-automation |
| `Account` | `id, accountId, name, active, connectionStatus, lastSyncedAt, createdAt` | hero, action-center, coverage, cost-automation, inventory |
| `Schedule` | `scheduleId, name` | cost-automation (name map) |
| `AuditLog` | `eventType, status, severity, timestamp, details` | hero, action-center, audit |
| `AgentOpsRun` | `id, source, status, durationMs, createdAt, taskDescription` | hero, action-center, agent-activity |
| `AgentOpsEvent` | `toolName` (where `eventType='tool_call'`) | agent-activity |
| `ScheduledTask` | `taskStatus` | agent-activity |
| `InventoryResource` | `resourceType, region, accountId, status, discoveredAt` | inventory |
| `InventorySyncStatus` | `syncedAt, accountsSynced` | coverage, inventory |

Status/enum vocabularies the dashboard depends on:

- `ScheduleExecution.status`: `pending | running | success | failed | partial`
- `Account.connectionStatus`: `connected` + anything else (default `unknown`)
- `AuditLog.severity`: `low | medium | high | critical | info`; `.status`: `success | error | warning | info`
- `AgentOpsRun.status`: `queued | in_progress | awaiting_input | awaiting_approval | completed | failed | cancelled`; `.source`: `slack | jira | api | scheduled`
- `AgentOpsEvent.eventType`: `planning | execution | tool_call | tool_result | reflection | revision | final | error`
- `ScheduledTask.taskStatus`: `active | paused | deleted`

**Multi-tenancy:** every query goes through `getTenantClient(tenantId)`, which injects
`WHERE tenant_id = …`. The dashboard repository issues no `$executeRaw`, so it is fully
covered by the extension. Keep it that way — raw SQL would need manual scoping.

**Auth/RBAC:** `authorize('read', 'Dashboard')`. `Dashboard` is one of the 6 top-level
modules in the permission matrix (`lib/rbac/types.ts`), mapping to itself via
`SUBJECT_TO_MODULE`. A single read permission gates all seven zones — there is no per-zone
authorization, so any user who can see the dashboard sees every zone.

---

## 9. Known gaps and caveats

Carry these forward knowingly, or fix them in a reimplementation.

**Broken links — every drilldown `href` is missing the `/app` prefix.** Real routes are
`/app/schedules`, `/app/accounts`, `/app/inventory`, `/app/agent-ops`, `/app/audit`. The
repository emits `/schedules?tab=executions`, `/accounts/{id}`, `/inventory?account={id}`,
`/agent-ops/runs/{id}`, `/audit-logs?severity=critical`. There are no `rewrites` in
`next.config.mjs`, so **all dashboard links 404**. Additionally `/audit-logs` is wrong on
two counts — the audit module lives at `/app/audit`. Fix: prefix with `/app` and rename
`audit-logs` → `audit`. (Also verify the query params — `?tab=executions`,
`?filter=stale`, `?status=failed` — are actually honored by the destination pages.)

**Placeholder / non-functional data:**
- `upcomingExecutions` — always `[]` (needs cron recurrence parsing)
- `newDiscovered` — always `0` (needs previous-scan diff)
- `requesterName` on pending approvals — always `null`
- `topTools[].successCount` / `.successRate` — always `0` (tool_call events have no outcome)
- `byRegion` (inventory) and `lastScanAt`/`accountsSynced` (coverage) — computed, never rendered
- Hero `auditLogs`/`prevAuditLogs` counts — fetched, never used
- `agent-approvals` and `critical-events` deltas — structurally always `0% neutral`

**Cost model:** flat `$0.10 × resourcesStopped`. `HOURLY_COST_MAP` is defined but unused by
all zone methods. Savings figures are directional indicators, not accounting numbers.

**Silent row caps:** `inventoryResource take: 10000`, `auditLog take: 5000`,
`agentOpsEvent take: 10000`. Past those thresholds the numbers are wrong with no UI signal.
`agentOpsRun.findMany` in agent-activity has **no cap at all** — a high-volume tenant over a
90-day range will load every run into memory.

**In-process aggregation.** Every zone does `findMany` → JS `Map` reduction instead of SQL
`GROUP BY`/`COUNT`. Fine at current scale; the first thing to change under load. The natural
fix is `groupBy`/raw aggregates — but raw SQL is *not* intercepted by the tenant extension,
so any `$queryRaw` rewrite must add `WHERE tenant_id = $1` manually.

**`scheduleName` in Action Center is the schedule ID.** `getCostAutomation` builds a
`scheduleMap` from `schedule.findMany` and resolves names properly; `getActionCenter` does
not, and sets `scheduleName: exec.scheduleId`. Copy the cost-automation approach.

**Naming vs. semantics:** "Open Findings by Severity" is a severity histogram of audit-log
rows in the window, not a findings backlog. "High Severity" in the summary is
critical + high combined. "Error Trend" counts severity ≥ high, not `status='error'`.

**Range is not URL state.** Not shareable, not restored on reload, not synced to the
drilldown links (which hardcode `?range=24h` on the agent-runs card).

**No auto-refresh.** No `refetchInterval`, no `staleTime` override, no websocket — despite
the "Real-time health" subtitle. Data refreshes on mount, range change, or manual reload.
`fetch` uses `cache: 'no-store'`, so each refetch does hit the server.

**Dead legacy surface.** `dashboard-types.ts` keeps 7 deprecated response types
(`KpiResponse`, `CostResponse`, `OperationsResponse`, `AgentResponse`,
`AuditDashboardResponse`, `InventoryResponse`, `KnowledgeBaseResponse`), the service and
repository interface keep 7 matching legacy methods, and `postgres.ts` lines 53–583 (≈530
lines, over half the file) implement them. Nothing in the current UI calls any of it —
a clean reimplementation drops all of it.

---

## 10. Replication checklist

Building this from scratch, in order:

1. **Types first** — `lib/dashboard-types.ts`: `TimeRange`, `DashboardLink`, `DeltaDirection`,
   the 7 zone response interfaces, and the 5 time helpers. Skip the deprecated block.
2. **Repository interface** — `IDashboardRepository` with the 7 zone methods.
3. **Repository impl** — one method per zone. Each: `getTenantClient(tenantId)` →
   `getTimeRangeDate(range)` → `Promise.all([...queries])` → JS aggregation → typed response
   with `href` on every drillable item. Constants: `DEFAULT_HOURLY_COST`,
   `STALE_SYNC_THRESHOLD_HOURS`, `formatCurrency`.
4. **Register in the factory** — `getDashboardRepository()`.
5. **Service** — thin pass-through; keep it so formatting/permission logic has a home.
6. **API route** — `GET /api/dashboard`, `authorize('read','Dashboard')` first,
   `getSessionTenantId()`, validate zone (400) and range (400), switch, envelope in
   `{ success, data }`, catch → 500.
7. **Client service** — `fetchZone<Z>(zone, range)` with the conditional `ZoneResponse<Z>`
   type map, `cache: 'no-store'`, throw on `!ok || !success || data === undefined`.
8. **Query keys** — add the `dashboard` branch with per-zone factories; range-independent
   zones take no argument.
9. **Hooks** — 7 `useQuery` wrappers, `DEFAULT_RANGE = '24h'`.
10. **Zone components** — 7 files, each with the error → skeleton → data guard chain from §5.
11. **Shell** — range `useState`, header, hero row, three `lg:grid-cols-2` rows.
12. **Page** — server component, `getAuthSession()` guard, render shell.
13. **RBAC** — ensure `Dashboard` exists in `Module` and `SUBJECT_TO_MODULE`, and that every
    role's `PermissionSet` grants it `read`.
14. **Fix the hrefs** — prefix `/app`, rename `audit-logs` → `audit` (§9).

Verification: `cd apps/web-ui && bun run lint && bun run test`, then load
`/app/dashboard` with each of the four ranges and confirm each zone renders, that a zone
whose query throws shows its inline red card without breaking siblings, and that every
drilldown link resolves.
