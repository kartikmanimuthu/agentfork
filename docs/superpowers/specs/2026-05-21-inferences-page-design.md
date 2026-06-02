# Design Spec — Inferences Page

**Date:** 2026-05-21
**Status:** Approved

## Problem Statement

The existing `/sessions` page only surfaces stateful inference calls (those with a `sessionId`). Stateless calls — single-turn API requests with no session — are recorded in `ApiKeyExecution` but invisible to operators in the dashboard. There is no unified view of all inference activity across an agent or tenant.

## Goals

- Show every `ApiKeyExecution` row in a single, filterable list regardless of whether it is stateful or stateless.
- Give operators at-a-glance health metrics (success rate, latency, cache hit rate) without requiring them to query the database.
- Provide a shareable detail page per execution for debugging and incident response.
- Fit naturally into the existing Analytics section of the sidebar.

## Non-Goals

- Does not replace or modify the `/sessions` page.
- Does not expose playground executions (those are scoped to `/agents/[id]/playground`).
- No write operations — this is a read-only observability surface.

## Data Model

The page is backed entirely by `ApiKeyExecution` (table: `api_key_executions`):

```
ApiKeyExecution
  id, apiKeyId, tenantId, agentId, agentVersionId?
  sessionId?          — null for stateless, FK to InferenceSession for stateful
  status              — running | completed | failed
  input Json          — { messages, sessionId, systemPrompt, temperature, maxTokens }
  output Json?        — { text } on success
  error String?       — error message on failure
  tokenUsage Json?    — { inputTokens, outputTokens, totalTokens }
  cacheHit Boolean
  latencyMs Int?
  webhookUrl String?
  webhookStatus String?
  webhookDeliveredAt DateTime?
  startedAt DateTime?
  completedAt DateTime?
  createdAt DateTime
```

Joined with:
- `Agent` (name, type) via `agentId`
- `AgentVersion` (version number, status) via `agentVersionId`
- `InferenceSession` (id, status, channel, channelMetadata) via `sessionId` — nullable

## Architecture

### New API routes

#### `GET /api/inferences`

Tenant-scoped via `getSessionTenantId(authOptions)`. Permission: `read` on `InferenceSession` (reuses existing RBAC subject — inferences are part of the same module).

**Query params:**

| Param | Type | Description |
|---|---|---|
| `agentId` | string | Filter by agent |
| `status` | `completed\|failed\|running` | Filter by execution status |
| `type` | `stateful\|stateless` | Stateful = sessionId IS NOT NULL; stateless = NULL |
| `cacheHit` | `true\|false` | Filter by cache hit |
| `fromDate` / `toDate` | ISO date | Range over `createdAt` |
| `search` | string | Fuzzy match on execution `id` |
| `page` | number | 1-based, default 1 |
| `limit` | number | Default 20, max 100 |

**Response shape:**

```json
{
  "stats": {
    "total": 1240,
    "successRate": 0.97,
    "avgLatencyMs": 843,
    "cacheHitRate": 0.31
  },
  "executions": [
    {
      "id": "clxxx",
      "agentId": "...",
      "agentVersionId": "...",
      "sessionId": "clyyy" | null,
      "status": "completed",
      "latencyMs": 720,
      "tokenUsage": { "inputTokens": 120, "outputTokens": 80, "totalTokens": 200 },
      "cacheHit": false,
      "webhookStatus": "delivered" | null,
      "createdAt": "2026-05-21T10:00:00Z",
      "completedAt": "2026-05-21T10:00:00.720Z",
      "agent": { "id": "...", "name": "Support Bot", "type": "simple" },
      "agentVersion": { "id": "...", "version": 3, "status": "published" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1240, "totalPages": 62 }
}
```

Stats are computed over the same `where` clause as the list query (respects all active filters including date range).

#### `GET /api/inferences/[id]`

Returns the full execution row plus joined relations:

```json
{
  "execution": { ...all fields... },
  "agent": { "id", "name", "type" },
  "agentVersion": { "id", "version", "status" },
  "session": { "id", "status", "channel", "channelMetadata" } | null
}
```

### New UI pages

#### `/inferences` — List page

**Stats strip** — four metric cards, scoped to the current filter window:
- Total Inferences
- Success Rate (%)
- Avg Latency
- Cache Hit Rate (%)

**Filter bar** (same pattern as `/sessions`):
- Search input (by execution ID)
- Agent dropdown
- Status select: All / Completed / Failed / Running
- Type select: All / Stateful / Stateless
- Cache select: All / Hit / Miss
- Date range (from / to)
- Apply + Clear buttons

**Table** — one row per execution:

| Column | Notes |
|---|---|
| ID | Truncated monospace, clickable |
| Agent | name + version |
| Type | "Stateful" or "Stateless" badge |
| Status | Colored badge (completed=default, failed=destructive, running=secondary) |
| Latency | Formatted ms / s |
| Tokens | `totalTokens` or — |
| Cache | Hit / Miss chip |
| Webhook | delivered / failed / — |
| When | Relative time (`createdAt`) |

Clicking any row navigates to `/inferences/[id]`.

Empty state: "No inferences found. Calls to `POST /api/v1/inference` appear here."

#### `/inferences/[id]` — Detail page

**Header bar:** execution ID (monospace), status badge, type badge (Stateful / Stateless), back button to `/inferences`.

**Execution summary card** (grid layout):
- Agent name + version
- Started at / Completed at
- Latency
- Token usage: input / output / total
- Cache hit
- Agent type

**Session card** (stateful only):
- Session ID as a link to `/sessions/[id]`
- Session status badge
- Channel + channelMetadata JSON preview (collapsed by default)

**Input / Output card** (two-panel):
- Left: Input messages rendered as chat bubbles (user = right-aligned, system prompt = collapsed accordion)
- Right: Output text with a copy-to-clipboard button

**Webhook card** (only when `webhookUrl` is set):
- URL, delivery status badge, delivered at timestamp
- Error detail if `webhookStatus = 'failed'`

**Error card** (only when `status = 'failed'`):
- Error message in a red-bordered code block

### Navigation

Add `Inferences` to `analyticsNav` in `components/layout/app-sidebar.tsx`:

```typescript
const analyticsNav = [
  { name: 'Dashboard', href: '/analytics', icon: BarChart3 },
  { name: 'Sessions',   href: '/sessions',   icon: History },
  { name: 'Inferences', href: '/inferences', icon: Zap },   // new
];
```

Update `isAnalyticsActive` to include `/inferences` and `/inferences/` paths.

## File Checklist

| File | Action |
|---|---|
| `apps/web-ui/app/api/inferences/route.ts` | New — list + stats endpoint |
| `apps/web-ui/app/api/inferences/[id]/route.ts` | New — detail endpoint |
| `apps/web-ui/app/(dashboard)/inferences/page.tsx` | New — list page |
| `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx` | New — detail page |
| `apps/web-ui/components/layout/app-sidebar.tsx` | Update — add Inferences nav item |

## Standards Compliance

- All API routes: Zod validation on query params, Pino structured logging, try/catch with typed error responses.
- All UI: shadcn/ui components only (Card, Badge, Button, Input, Select, Skeleton, Separator, Tabs).
- No direct `process.env` access — use the typed env object.
- RBAC: `authorize('read', 'InferenceSession', authOptions)` on both API routes.
