# Custom SQL Reports (Metabase-style) — Design

**Date:** 2026-06-21
**Status:** Approved (scope decisions locked via brainstorming)
**Branch:** `metabase-reports`

## Summary

Let a **tenant admin** write a read-only SQL query against the application's own
PostgreSQL database, run it, turn the result set into a graph by mapping result
columns to chart axes, and **save it as a Report** scoped to the tenant. This is a
Metabase-style "native query + visualization + save" flow.

This is distinct from the existing structured dashboards (commit #50,
`Dashboard`/`DashboardWidget` + guided metric builder). Reports are a **new,
separate entity** with free-form SQL.

## Locked Decisions

1. **Datasource** — the app's own Postgres, **read-only**, tenant-scoped. No
   external DB connection layer.
2. **Isolation** — **PostgreSQL Row-Level Security (RLS)**. RLS policies on a
   curated set of reportable tables key on the `app.tenant_id` GUC. Report queries
   run under a dedicated **non-owner read-only role** (`chatbot_report_ro`) so RLS
   is enforced (table owners bypass RLS; the app's normal queries are unaffected).
3. **Report model + viz** — new `Report` entity (`tenantId`, `name`, `sqlText`,
   `vizType`, `vizConfig`). Editor: SQL pane → Run → result grid → pick chart type
   + map columns (x / y / series) → Save. Reuses Recharts. New `/reports` route.

## Security Model (the core of this feature)

Admin-authored SQL is untrusted input executed against a shared multi-tenant DB.
Three layers enforce safety:

### Layer 1 — Dedicated read-only role (no writes, no DDL, no base-table reads)

```sql
CREATE ROLE chatbot_report_ro NOLOGIN;
-- app's connection user must be able to SET ROLE to it:
GRANT chatbot_report_ro TO CURRENT_USER;
-- only SELECT, only on the curated reportable tables:
GRANT SELECT ON inference_sessions, session_analytics, agents,
                agent_executions, api_key_executions, scores TO chatbot_report_ro;
```

The role has **no** INSERT/UPDATE/DELETE/DDL grants and SELECT only on the
allow-listed tables. Even a crafted query physically cannot write or read other
tables.

### Layer 2 — RLS policies pin every row to the current tenant

```sql
ALTER TABLE inference_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inference_sessions
  FOR SELECT TO chatbot_report_ro
  USING ("tenantId" = current_setting('app.tenant_id', true));
-- repeated for each reportable table
```

`current_setting('app.tenant_id', true)` returns NULL when unset → policy matches
no rows → **default-deny**. The app owner role bypasses RLS, so existing app
behavior is unchanged.

### Layer 3 — Per-query transaction envelope

Every run executes inside one transaction, then **rolls back** (read-only):

```sql
BEGIN;
SET LOCAL ROLE chatbot_report_ro;
SELECT set_config('app.tenant_id', $tenantId, true);   -- parameterized
SET LOCAL statement_timeout = '10000';                  -- 10s cap
SET LOCAL idle_in_transaction_session_timeout = '15000';
-- <admin SQL>  (row limit applied by wrapping/append LIMIT)
ROLLBACK;
```

Additional guards in the service:
- Reject empty/over-length SQL (max 20 000 chars) at the Zod boundary.
- Enforce a hard **row cap (1000)** and a column cap on results returned to UI.
- Result values are returned as-is; the UI treats them as data, never HTML.

### Reportable tables (v1 allow-list)

`inference_sessions`, `session_analytics`, `agents`, `agent_executions`,
`api_key_executions`, `scores`. All have a `tenantId` column. Adding a table later
= add it to the GRANT + an RLS policy in a new migration. Documented in the spec.

## Data Model

```prisma
model Report {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  sqlText     String                       // the native query
  vizType     String   @default("table")   // table|line|bar|area|pie|kpi
  vizConfig   Json     @default("{}")       // { xKey, yKeys[], seriesKey? }
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("reports")
}
```

`vizConfig` shape (validated by Zod): `{ xKey: string, yKeys: string[], seriesKey?: string }`.
For `table` viz, vizConfig may be empty. For `kpi`, first row / first numeric col.

## Components & Interfaces

### Backend (`libs/shared/src`)

- **`reports/report-viz.ts`** — shared types + Zod for `vizType`, `vizConfig`,
  `ReportResult` (`{ columns: string[], rows: Record<string, unknown>[],
  rowCount, truncated }`). Allow-list constant `REPORTABLE_TABLES`.
- **`validation/schemas/reports.ts`** — `createReportSchema`, `updateReportSchema`,
  `runReportSchema` (`{ sql }`). SQL length + non-empty checks.
- **`services/report-query-service.ts`** — `ReportQueryService.run(tenantId, sql)`:
  opens the RLS transaction envelope, sets role + GUC + timeout, executes, maps
  rows → `ReportResult`, rolls back. Single responsibility: safe execution.
- **`services/report-service.ts`** — `ReportService` CRUD (list/get/create/update/
  remove), tenant-scoped, `assertOwned` guard. Mirrors `DashboardService`.
- **RBAC** — new module `Reports`; `SUBJECT_TO_MODULE.Report = 'Reports'`;
  `ROLE_PERMISSIONS` entries (Owner/Admin full, Member create/read/update, Viewer
  read). **Write actions additionally gated to admins** at the route (create/update/
  delete require `isAdmin`), since SQL authoring is an admin capability.

### API (`apps/web-ui/app/api/reports`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/reports` | GET / POST | list / create |
| `/api/reports/[id]` | GET / PUT / DELETE | load / update / delete |
| `/api/reports/run` | POST | execute ad-hoc SQL → `ReportResult` (admin only) |
| `/api/reports/[id]/run` | POST | execute a SAVED report's vetted SQL → `ReportResult` (read-gated, so members/viewers can view) |
| `/api/reports/schema` | GET | introspect reportable tables + columns |

All follow the existing handler conventions: `getSessionTenantId`, `authorize`,
Zod `safeParse` → 422, Pino logger, typed try/catch with 401/403/404/500.

### Frontend (`apps/web-ui`)

- **`app/(dashboard)/reports/page.tsx`** — list reports (cards), New Report button.
- **`app/(dashboard)/reports/[id]/page.tsx`** — editor: SQL textarea + Run, result
  grid, schema sidebar (tables/columns), viz-type picker, column-mapping controls,
  live chart preview, Save / name / description.
- **`app/(dashboard)/reports/new/page.tsx`** — same editor in create mode.
- **`components/reports/`** — `sql-editor.tsx`, `result-table.tsx`,
  `report-chart.tsx` (Recharts, generic over result columns), `viz-mapper.tsx`,
  `schema-explorer.tsx`, hooks `use-run-report.ts`, `use-report-schema.ts`.
- All UI via shadcn/ui; forms validated with the shared Zod schemas before submit.

## Data Flow

1. Admin opens `/reports/new`, sees schema sidebar (from `/api/reports/schema`).
2. Types SQL, clicks **Run** → `POST /api/reports/run` → `ReportQueryService`
   executes under RLS envelope → returns `{ columns, rows, truncated }`.
3. Result renders in a grid. Admin picks viz type + maps columns (x/y/series).
4. Chart preview renders client-side from the already-fetched result.
5. **Save** → `POST /api/reports` persists `{ name, sqlText, vizType, vizConfig }`.
6. Re-opening a report re-runs its `sqlText` and re-applies `vizConfig`.

## Error Handling

- SQL errors (syntax, permission denied, timeout) → caught in service, returned as
  a typed `{ error: { type: 'query_error', message } }` with **sanitized** message
  (no internal stack); 400 status. UI shows it inline below the editor.
- Statement timeout → friendly "Query exceeded 10s limit" message.
- Permission-denied (table not in allow-list) surfaces as query_error — expected.

## Testing

- **Unit (Vitest)**: `report-query-service` envelope construction (mock `$transaction`,
  assert role/GUC/timeout statements + rollback); `report-service` CRUD tenant
  scoping; Zod schema edge cases; viz-config validation.
- **Integration intent**: RLS verified by a test that runs a query for tenant A and
  asserts no tenant-B rows (documented; requires DB).
- **E2e (Playwright)**: new `modules/reports/` — create a report, run a simple
  query, save, see it listed. Tagged `@reports @regression`.

## Out of Scope (YAGNI)

- External datasource connections (separate future phase).
- Query result caching / scheduled report refresh.
- Pinning reports onto #50 dashboards (possible later bridge).
- SQL autocomplete / full editor (plain textarea + schema sidebar for v1).
- Export to CSV/PDF (can follow).
```

