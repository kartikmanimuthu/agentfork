# HITL pause/resume in playground (session auth, inline resume)

**Date:** 2026-05-26
**Type:** feature
**Files:**
- `apps/web-ui/app/api/agents/[id]/playground/route.ts` — add `onPause` to graph executor call
- `apps/web-ui/app/api/agents/[id]/playground/resume/route.ts` — new inline session-auth resume endpoint
- `apps/web-ui/hooks/use-playground.ts` — handle `execution_paused` SSE event, add `handleResume()`
- `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx` — pause banner UI, route `onSend` to `handleResume` when paused

## What changed

Graph agents with Human nodes now pause and resume in the playground canvas, not just through the API key path.

**Pause flow:** When the executor hits a Human node, the playground route's `onPause` callback fires. It creates a `PausedExecution` DB record (same as the API key path) and updates `AgentExecution.status = 'paused'`. The `execution_paused` SSE event already reaches the client because `HumanNodeExecutor` emits it via `ctx.emit()` → `onEvent` → `sendEvent`. The frontend hook detects the event type and stores `{ prompt, resumeToken, executionId }` in `pauseInfo` state.

**Resume flow (inline — no worker):** The playground uses `POST /api/agents/:id/playground/resume` with session auth. It claims the token with the same CAS atomics as the API key path (`claimToken()`), restores graph state (injects `userInput` into `outputChannel`, clears `__paused`/`__resumeToken`, sets `currentNodeId = nextNodeId`), marks the execution `running`, then calls `executeFromState()` inline and streams SSE back to the browser. On completion it marks `completed`; on a second pause it creates a new `PausedExecution` and sets `paused` again (chained human nodes work).

**UI:** When `pauseInfo` is set, an amber banner appears above the chat input showing the Human node's prompt. The `ChatInput.onSend` is routed to `handleResume()` instead of `handleSend()` — the user just types their reply as normal, no separate UI element needed. The banner clears once the resumed execution completes or pauses again.

**Why inline instead of worker:** The playground is interactive and typically runs locally or on a long-lived server, not a cold-start serverless function. Skipping the worker/202/poll cycle gives the user a smooth streaming experience with no polling delay. The API key path keeps async because it must be serverless-safe.

## Why

The HITL feature was built only for the API key path (async worker). Developers testing graphs with Human nodes in the playground canvas had no way to interact — execution would pause, the token would be emitted via SSE, and there was nothing to submit a reply through. The playground looked broken.

## Research

- **LangFlow**: Shows a "waiting for input" state inline in the canvas, accepts text in a dedicated input that appears on the relevant node, submits synchronously and streams the continuation. Same inline sync pattern.
- **Flowise**: Similar approach — execution pauses, user types in the chat widget, the reply goes to the same endpoint, response streams back immediately.
- Both production tools avoid async worker indirection for the playground/canvas path. We match this pattern.

## Watch for

- The resume route loads the agent graph from `agentExecution.agentVersion.config` — it must be the version that was active when execution started, not the latest draft. This is correct because `AgentExecution.agentVersionId` was set at execution time. But if the user edits and publishes a new version mid-execution, the old version's graph is still used for resume (correct behaviour).
- `pauseInfo` is cleared when `handleResume()` is called — before the resumed SSE stream starts. If the resume request fails immediately (401, 410), the banner disappears but no error is shown automatically. The `onError` callback handles it via toast.
- Chained human nodes: the resume route has its own `onPause` handler. If the graph pauses again mid-resume, a new `PausedExecution` is created and `pauseInfo` is set again via `readGraphStream`. This is tested manually but not in unit tests yet.
- `readGraphStream()` was extracted as a shared function used by both `handleSend()` and `handleResume()`. If the SSE event format changes (e.g. `reason` vs `prompt` key on `execution_paused`), update both callers.
