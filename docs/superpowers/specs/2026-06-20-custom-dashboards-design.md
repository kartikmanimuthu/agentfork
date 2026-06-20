# Custom Dashboards — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design phase)
**Author:** Brainstormed with Claude Code

## Summary

A dynamic custom-dashboard feature for the multi-tenant chatbot SaaS. Tenant
members compose their own dashboards from a **guided metric builder**: pick a
data source, a metric/aggregation, a group-by dimension, filters, a date range,
and a visualization type. Widgets are arranged on a drag-and-drop resizable
grid. Dashboards are **tenant-shared** (org-level): anyone with the manage
permission builds/edits them, everyone with read access views them.

The architecture's centerpiece is a **server-side Source Registry** that acts as
the single security boundary — users compose from a constrained vocabulary, never
raw queries — keeping the feature flexible without exposing arbitrary query power
in a multi-tenant system.

## Goals

- Tenant users build dashboards without engineering involvement.
- Cover business use cases beyond the fixed `/analytics` page.
- Safe by construction in a multi-tenant DB: no arbitrary queries, no cross-tenant leaks.
- Additive — does not replace the existing `/dashboard` or `/analytics` pages.

## Non-Goals (v1 scope boundaries — YAGNI)

- Scores/evaluations & Audit/API-usage data sources (registry is built to add them later, no schema change).
- Per-user private dashboards (tenant-shared only in v1).
- Full SQL / query-DSL freedom for end users.
- Cross-source joins, computed/derived metrics.
- Public share links, scheduled email exports, real-time streaming.
- Replacing the existing `/dashboard` and `/analytics` pages.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Power level | **Guided metric builder** (source + metric + dimension + filters + viz) |
| Ownership | **Tenant-shared (org-level)** |
| v1 data sources | **Sessions & messages**, **Session analytics** |
| Layout | **Drag-and-drop resizable grid** (react-grid-layout) |
| Viz types | **Time-series (line/area)**, **bar**, **pie/donut**, **KPI stat card** |

## Architecture

### Core flow

```
User configures widget (UI)  ──►  WidgetQuerySpec (JSON)
                                        │
                                        ▼
                        POST /api/dashboards/query
                                        │
                          Zod-validate spec against ──► Source Registry
                          (reject anything not whitelisted)
                                        │
                          dashboard-query-service builds a
                          tenant-scoped aggregation (tenantId always
                          bound as a parameter, never user-supplied)
                                        │
                                        ▼
                          Aggregated rows  ──►  recharts renderer
```

### WidgetQuerySpec

The JSON a widget stores and sends to `/query`:

```ts
{
  source: "sessions" | "session_analytics",
  metric:    { agg: "count" | "avg" | "sum", field?: string },
  dimension?: string,                       // group-by: channel, status, agent, sentiment…
  timeBucket?: "day" | "week" | "month",    // time-series only
  filters:    [{ field, op, value }],
  dateRange:  { preset: "last_7d" | "last_30d" | "last_90d" } | { from, to },
  vizType:    "line" | "area" | "bar" | "pie" | "kpi"
}
```

### Source Registry (the security boundary)

A plain TypeScript module in `libs/shared` (e.g. `src/dashboards/source-registry.ts`).
Per source it declares:

- base Prisma model,
- allowed **metrics** (field + permitted aggregations),
- allowed **dimensions** (mapped to real columns),
- allowed **filters** (field + operators),
- valid viz types,
- how tenant scoping is applied.

The Zod schema for `WidgetQuerySpec` is **derived from** the registry, so any spec
referencing a source/field/agg/dimension/filter not in the registry is rejected at
the boundary. User-supplied strings are looked up in the registry — only the
registry's own constants ever reach the query layer.

The same `/api/dashboards/query` endpoint serves both the **live preview** while
building a widget and the **render** of saved widgets (one execution path, DRY).

## Data Model (Prisma)

Follows existing conventions: `@@map`, camelCase fields, `@@index([tenantId])`,
cascade deletes.

```prisma
model Dashboard {
  id          String            @id @default(cuid())
  tenantId    String
  name        String
  description String?
  isDefault   Boolean           @default(false)   // optional "landing" dashboard per tenant
  createdById String                              // attribution only (ownership is tenant-level)
  widgets     DashboardWidget[]
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("dashboards")
}

model DashboardWidget {
  id          String    @id @default(cuid())
  dashboardId String
  tenantId    String                  // denormalized for direct tenant-scoped queries + defense in depth
  title       String
  vizType     String                  // "line" | "area" | "bar" | "pie" | "kpi"
  querySpec   Json                    // the validated WidgetQuerySpec
  layout      Json                    // react-grid-layout: { x, y, w, h }
  order       Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  dashboard   Dashboard @relation(fields: [dashboardId], references: [id], onDelete: Cascade)

  @@index([dashboardId])
  @@index([tenantId])
  @@map("dashboard_widgets")
}
```

Notes:
- `querySpec`/`layout` as `Json` — spec shape evolves without migrations; `layout`
  matches react-grid-layout's `{x,y,w,h}` natively.
- `tenantId` denormalized onto the widget — `/query` enforces tenant scope on the
  widget directly; never rely solely on a join for isolation. Always validated
  against the session tenant.
- `isDefault` — a tenant can mark one dashboard as the team's landing view.
- `createdById` — attribution only; does not gate access (ownership is tenant-level).
- react-grid-layout owns geometry via `layout`; `order` is a fallback for non-grid
  contexts (e.g. mobile stacking).

## API Routes

All tenant-scoped via `getSessionTenantId()` + `authorize()`.

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboards` | GET / POST | List tenant dashboards / create |
| `/api/dashboards/[id]` | GET / PUT / DELETE | Read (with widgets) / rename+set default+save layout / delete |
| `/api/dashboards/[id]/widgets` | POST | Add a widget |
| `/api/dashboards/[id]/widgets/[wid]` | PUT / DELETE | Update widget (title, spec, layout) / remove |
| `/api/dashboards/query` | POST | Execute a `WidgetQuerySpec` → aggregated rows (preview + render) |
| `/api/dashboards/registry` | GET | Return the registry metadata that drives the builder's field options |

## Query Execution Service

`libs/shared/src/services/dashboard-query-service.ts` — where safety lives:

1. **Validate** the spec with the registry-derived Zod schema. Reject unknown
   source / metric field / aggregation / dimension / filter field → 400 typed error.
2. **Resolve** the spec against the registry to get real column names and the base
   model. User strings never reach SQL directly — looked up in the registry; only
   registry constants are used.
3. **Build the aggregation:**
   - Simple group-by / KPI / distribution → Prisma `groupBy` / `aggregate` / `count`
     (fully parameterized, no raw SQL).
   - Time-series (`timeBucket`) → `$queryRaw` with `date_trunc($1, "createdAt")`.
     The bucket (`day|week|month`) is selected from an **allow-list constant**, never
     interpolated; `tenantId`, date bounds, and filter values are **bound parameters**;
     column names come from the registry.
4. **Tenant scope is non-negotiable:** `tenantId = <session tenant>` injected into
   every query as a bound param. The widget's denormalized `tenantId` is re-checked
   against the session on render.
5. **Guardrails:** cap result rows (top-N dimensions + "Other" bucket), clamp date
   ranges to a max window, sane `staleTime` on the client React Query cache.

Every handler and service method: `try/catch`, Pino logs with
`{ tenantId, userId, dashboardId, widgetId }`, typed error responses.

## Frontend & UX

### Routes (new `(dashboard)/dashboards/` group)

- `/dashboards` — list of the tenant's dashboards (cards), "New dashboard" button.
- `/dashboards/[id]` — the canvas. **View mode** by default; **Edit mode** toggle
  gated by the manage permission.

### Canvas (react-grid-layout, responsive)

- **View mode:** renders saved widgets; each is a self-contained component fetching
  its own data via React Query (`queryKey: ['widget-data', spec]` → `POST /query`).
  Independent loading/error states per widget.
- **Edit mode:** drag to move, drag-handle to resize; layout changes batch-save to
  `PUT /api/dashboards/[id]` (debounced). "Add widget" opens the builder.

### Widget builder (shadcn `Sheet` drawer — config left, live preview right)

```
┌──────────────────────────┬───────────────────────────┐
│ 1. Data source           │                            │
│    ○ Sessions & messages │      LIVE PREVIEW          │
│    ○ Session analytics   │   (renders via /query as   │
│ 2. Metric                │    you change any field)   │
│    [count ▾] [field ▾]   │                            │
│ 3. Group by (dimension)  │     ┌──────────────┐       │
│    [channel ▾]           │     │   ▁▃▅▇▅▃      │       │
│ 4. Time bucket           │     └──────────────┘       │
│    [day ▾]               │                            │
│ 5. Filters  [+ add]      │                            │
│ 6. Date range [last 30d▾]│                            │
│ 7. Visualization         │                            │
│    [line|area|bar|pie|kpi]                            │
│ 8. Title  [____________] │                            │
│        [Cancel] [Save]   │                            │
└──────────────────────────┴───────────────────────────┘
```

Field options (metrics, dimensions, valid viz types) are driven by the selected
source's registry entry via `GET /api/dashboards/registry`. Invalid combinations
(e.g. pie + time bucket) are disabled in the UI **and** re-validated server-side —
UI guidance, server enforcement.

### Renderer

`<WidgetRenderer vizType data />` — one component maps `vizType` → recharts chart
(reusing existing `ChartContainer`/`ChartTooltip` wrappers) for line/area/bar/pie,
and a shadcn stat `Card` for `kpi` (big number + optional % vs previous period).
Shared by preview and saved render so they look identical.

### Standards

- Every builder form input validated with Zod before the `/query` call (mirrors the
  server schema).
- shadcn/ui components only — Sheet, Card, Select, Tabs, Button, etc.; no raw HTML
  form elements.

## RBAC

Add a `Dashboard` resource to `libs/shared/src/rbac/`:

- `read` → view dashboards & widget data.
- `create` / `update` / `delete` → build/edit (admins or a "manage dashboards" role).

Every API handler calls `authorize(<action>, 'Dashboard', authOptions)` — same
pattern as `InferenceSession`. The Edit-mode UI toggle keys off the same permission.

## Mandatory Standards (per CLAUDE.md)

- **Zod** at every API boundary; registry-derived `WidgetQuerySpec` schema is the
  centerpiece, reused client-side.
- **T3 Env** for any new env var (none anticipated for v1).
- **shadcn/ui only** for UI.
- **try/catch + Pino** in every handler and service method, structured context, typed
  error responses.

## Testing

- **Unit (Vitest)** — security-critical paths: registry rejects unknown
  source/field/agg/dimension/filter; query-service always injects `tenantId`;
  time-bucket only accepts allow-listed values; aggregation shape correct per viz type.
- **E2e (Playwright)** — new `modules/dashboards/` + `@dashboards` tag: create a
  dashboard → add a widget via builder → see it render → reload persists. Wire into
  the e2e tag taxonomy.

## Dependencies

- `react-grid-layout` (+ `@types/react-grid-layout`) — the only new runtime dep.
- recharts, shadcn chart wrappers, @tanstack/react-query — already present.

## Future (post-v1)

- Add Scores/evaluations & Audit/API-usage sources to the registry.
- Seed the existing analytics page as a default dashboard.
- Per-user private dashboards; public share links; scheduled exports.
