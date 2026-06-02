# Human-in-the-Loop (HITL) Pause/Resume Design

**Date:** 2026-05-26
**Status:** Approved — implementation plan at `docs/superpowers/plans/2026-05-26-human-in-the-loop.md`

---

## Goal

Allow graph agents to pause execution at a Human node, persist state durably, present a prompt to the user, and resume execution asynchronously when the user replies — in a way that survives serverless cold starts and concurrent requests.

---

## Problem Statement

The graph executor runs a while-loop. When it hits a Human node, it needs to stop and wait for human input — potentially for hours or days. Three things make this hard:

1. **Serverless limits:** Vercel/Lambda kill long-running connections (29–60s). You cannot hold an open HTTP connection while waiting for human input.
2. **Double-resume race:** If two requests arrive with the same resume token, both could trigger execution — causing duplicate completions or corrupted state.
3. **DRY violation:** A naive implementation duplicates the entire execution loop in `executeFromState()`, making it a maintenance burden.

---

## Architecture

### Pause Flow

```
Client → POST /api/v1/inference
         → GraphExecutor.execute()
         → HumanNodeExecutor sets channels.__paused = true
         → runLoop() detects __paused, calls onPause callback
         → onPause: create PausedExecution row, set ApiKeyExecution.status = 'paused'
         → SSE emits execution_paused event (with prompt shown to user)
         → SSE stream closes
         → Client receives: { type: 'execution_paused', prompt: '...', resumeToken: '...' }
```

### Resume Flow

```
Client → POST /api/v1/resume { resumeToken, userInput }
         → CAS claim: UPDATE paused_executions SET resumedAt=now WHERE resumeToken=? AND resumedAt IS NULL AND expiresAt > now
         → count=0? → 410 Gone (invalid/expired/already used)
         → Enqueue pg-boss job: resume-agent-execution
         → Return 202 { executionId, status: 'queued' }

Client → polls GET /api/v1/executions/:id until status = 'completed' | 'failed'

Worker → pg-boss picks up resume-agent-execution job
       → Load PausedExecution row (already claimed)
       → Restore graphState, inject userInput into outputChannel channel
       → Clear __paused = false, __resumeToken = null
       → Set currentNodeId = nextNodeId
       → graphExecutor.executeFromState()
       → On completion: update ApiKeyExecution { status: 'completed', output: { text } }
       → On second pause: create new PausedExecution, keep ApiKeyExecution status = 'paused'
```

### DRY: Shared runLoop

Both `execute()` and `executeFromState()` call a private `runLoop(initialState, graph, metadata, options)`. Pause detection lives in `runLoop()` once.

```
execute()           → createInitialState() → runLoop()
executeFromState()  →         (use as-is) → runLoop()
```

---

## Data Model

### PausedExecution

| Column | Type | Notes |
|---|---|---|
| id | cuid | PK |
| resumeToken | uuid | Unique — single-use claim key |
| tenantId | String | Tenant isolation |
| agentId | String | Which agent was running |
| executionId | String | References ApiKeyExecution.id (loose coupling, no FK) |
| graphState | Json | Full GraphState at pause point |
| prompt | String | HumanNodeConfig.prompt — shown to user |
| outputChannel | String | HumanNodeConfig.outputChannel — where to write reply |
| nextNodeId | String? | First node after human node (null if terminal) |
| expiresAt | DateTime | Now + 24h — hard expiry |
| resumedAt | DateTime? | Null until claimed. CAS sentinel. |
| createdAt | DateTime | Auto |

Indexes: `tenantId`, `resumeToken`, `expiresAt`, `executionId`

---

## Key Design Decisions

### 1. Async Resume (202 + Worker + Polling) vs Sync

**Decision: Async.**

Sync resume holds an HTTP connection open while the graph runs (potentially 30–120s). This breaks on:
- Vercel: 60s function timeout
- AWS Lambda + API Gateway: 29s hard limit (non-configurable)
- Cloudflare Workers: 30s CPU limit

Async resume returns immediately (202), enqueues a pg-boss job, and the client polls. This works on all serverless targets.

**UX tradeoff:** No real-time streaming on resumed execution. Client must poll (1–2s interval). Acceptable for chatbot use case — response appears in full when ready.

**Follow-on upgrade:** If streaming is needed, add Postgres `LISTEN/NOTIFY`: worker publishes `text_delta` events via `pg_notify('exec:{executionId}', payload)`, new SSE endpoint `GET /api/v1/executions/:id/stream` forwards them. No Redis. Drop-in.

### 2. Atomic CAS Token Claiming

**Decision: `updateMany WHERE resumedAt IS NULL AND expiresAt > now`**

Only one concurrent caller gets `count: 1`. All others get `count: 0` and are rejected (410 Gone). Eliminates double-resume race condition without application-level locking or Redis.

The old approach (`markResumed()` before execution) had a crash-loss bug: if the process died after marking but before executing, the token was consumed but execution never happened. The CAS approach marks only after the job is successfully enqueued.

### 3. 24-Hour Expiry

Human nodes time out after 24 hours. A nightly cron (00:30 UTC / 06:00 IST) sweeps expired unclaimed executions, marks `resumedAt = now`, and marks parent `ApiKeyExecution.status = 'failed'` with a timeout message.

### 4. Graph Stub Replacement (Task 4)

The inference route's graph branch currently returns simulated text. Task 4 replaces it with real `GraphExecutor` execution. This is a prerequisite for HITL to work end-to-end.

---

## API Contract

### POST /api/v1/resume

**Auth:** API key (same as inference endpoint)

**Request:**
```json
{ "resumeToken": "uuid", "userInput": "string" }
```

**Responses:**
- `202` — `{ "executionId": "...", "status": "queued" }`
- `400` — missing/invalid fields
- `403` — token belongs to different tenant
- `410` — token invalid, expired, or already used

### GET /api/v1/executions/:id

**Auth:** API key

**Response:**
```json
{
  "executionId": "string",
  "status": "running" | "completed" | "failed" | "paused",
  "output": { "text": "string" } | null,
  "error": "string" | null
}
```

Poll until `status === 'completed'` or `status === 'failed'`.

---

## SSE Events (from inference endpoint during execution)

| Event type | When emitted |
|---|---|
| `node_start` | Before each node runs |
| `node_complete` | After each node succeeds |
| `state_update` | After state channels are updated |
| `execution_paused` | When human node pauses execution |
| `node_error` | On node failure |
| `execution_complete` | When graph runs to completion without pausing |
| `done` | Final text output (non-paused execution) |
| `error` | Execution failed |

---

## ExecutionOptions Interface

```typescript
export interface PauseInfo {
  resumeToken: string;
  nextNodeId: string | null;
  prompt: string;
  outputChannel: string;
  state: GraphState;
}

export interface ExecutionOptions {
  onEvent?: (event: ExecutionEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  onPause?: (info: PauseInfo) => Promise<void>;
}
```

---

## What This Doesn't Include

- **Frontend HITL UI** — separate plan. Needs: display `execution_paused` prompt to user, collect input, call `POST /resume`, poll for result, display final output.
- **Chained human nodes** — supported by the architecture (worker re-uses `onPause`), but not explicitly tested in the plan.
- **Streaming on resumed execution** — deferred to follow-on Postgres `LISTEN/NOTIFY` upgrade.
- **Per-node checkpointing** — LangGraph saves state at every node. We save only at pause points. Acceptable for chatbot use case.

---

## Comparison to Production Systems

| Feature | This design | LangGraph | Step Functions |
|---|---|---|---|
| Durable state at pause | ✅ Postgres JSON | ✅ Checkpointer | ✅ Execution history |
| Single-use resume token | ✅ CAS updateMany | ✅ thread_id + checkpoint | ✅ task token |
| Async resume | ✅ pg-boss | ✅ External trigger | ✅ SendTaskSuccess |
| Per-node checkpointing | ❌ Pause only | ✅ Every node | ✅ Every state |
| Streaming on resume | ❌ (polling) | ✅ | ❌ |
| No Redis required | ✅ | Depends on checkpointer | N/A |

Our design matches LangGraph in the areas that matter most for correctness (durable state, single-use tokens, async resume). We trade per-node checkpointing and streaming-on-resume for simplicity — reasonable for a chatbot.
