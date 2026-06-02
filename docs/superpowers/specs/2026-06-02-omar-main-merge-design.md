# Merge Design: omar-updating-graph-agent ← bitbucket/main

**Date:** 2026-06-02  
**Branch:** `omar-updating-graph-agent`  
**Strategy:** Manual cherry-pick of main's changes into omar's branch (no `git merge` to avoid conflict markers)  
**Commit tier:** 3 grouped commits by dependency layer

---

## Context

`omar-updating-graph-agent` contains:
- Real `GraphExecutor` replacing the fake graph simulation
- `PausedExecutionService` for human-in-the-loop (HITL) pause/resume
- Bedrock mantle routing for DeepSeek/Kimi models (`stopWhen: stepCountIs()`)
- Resume API routes and worker jobs

`bitbucket/main` contains:
- Multimodal file support (S3, ContentResolver, attachments on messages)
- Enhanced playground console (SSE event telemetry, metrics, timing)
- SDK widget service, feedback/CSAT services
- Combobox model selector (replaces Select dropdown)
- Zod validation on inference API request body
- SSE format for SDK widget clients
- WhatsApp integration, new Prisma models

Both sets of features must be preserved in the merged branch.

---

## SDK Decisions (verified)

| Item | Decision |
|---|---|
| `stopWhen: stepCountIs(5)` | Keep Omar's — `maxSteps` removed in AI SDK v5/v6 |
| `createOpenAI` + `.chat()` for mantle | Keep Omar's — correct pattern for OpenAI-compatible endpoints |
| Bedrock Mantle endpoint | Keep Omar's — real AWS GA endpoint (March 2026) for DeepSeek/Kimi |
| `toUIMessageStreamResponse()` | Keep — stable in `ai@^6` |
| `ContentResolver` / `MessageAttachment` | From main — custom code in `libs/ai/src/content-resolver.ts` |

---

## File-by-File Decisions

### Commit 1 — Foundation Layer

#### `prisma/schema.prisma`
- Keep all of main's new models: `SdkWidget`, `SdkWidgetVersion`, `MessageFeedback`, `CsatResponse`, WhatsApp models
- Keep main's `attachments Json? @default("[]")` field on `InferenceSessionMessage`
- Add Omar's `PausedExecution` model from omar branch
- Preserve all migration files from both branches in chronological order

#### `libs/shared/src/index.ts`
- Combine all exports from both branches
- Omar adds: `PausedExecutionService` + types
- Main adds: `SdkWidgetService`, `FeedbackService`, `CsatService` + types
- Deduplicate `S3Service` if both added it

#### `libs/shared/src/validation/schemas/agents.ts`
- Base: Omar's version
- `targetCommand` in `httpBridgeTransportSchema`: Keep Omar's `.optional()` — runtime never reads it, form UI treats it as optional on both branches
- Add main's `data.attachments` sub-schema to `playgroundMessageSchema`
- Add main's top-level `attachments` array to `playgroundRequestSchema`
- Adopt main's `.nullable()` on `createPlaygroundSessionSchema.name` and `.configOverrides`

#### `libs/ai/src/providers/bedrock.ts`
- Take Omar's version entirely — correct `ai@^6` API (`stopWhen: stepCountIs()`, mantle routing, `createOpenAI`)
- Main's version uses removed `maxSteps` API — discard

#### `apps/web-ui/components/llm-providers/provider-model-select.tsx`
- Take main's Combobox version entirely
- Props interface is IDENTICAL on both branches — zero risk to callers
- Pure enhancement (adds search/custom input)

#### `apps/workers/tsconfig.json`
- Merge: Omar adds `exclude: ["src/**/*.test.ts"]`; Main restructures build config
- Keep all changes from both

#### `.env.example`
- Combine env vars from both branches
- Omar adds: `AWS_BEARER_TOKEN_BEDROCK`
- Main adds: WhatsApp, SDK widget vars

#### `package.json`
- Combine dependencies from both branches
- Resolve version conflicts toward newer version

---

### Commit 2 — API Routes

#### `apps/web-ui/app/api/v1/inference/route.ts`
**Strategy: Start from main, replace graph section with Omar's.**

Keep from main:
- Zod `inferenceRequestSchema` with multimodal content parts
- S3/ContentResolver multimodal normalization
- SSE format (`?format=sse`) for SDK widget
- Improved non-stream path (proper tokenUsage, `for await` drain)
- `attachments` on session messages

Replace in main (discard fake simulation, insert Omar's):
- Real `GraphExecutor` + `createNodeExecutors()`
- `PausedExecutionService` instantiation
- `onPause` callback: saves to DB, sets status to `'paused'`
- SSE stream response with `enc()` events
- Session append after graph completes

Integration point: Use `normalizedMessages` (main's multimodal format) as `inboxMessages` for graph execution.

#### `apps/web-ui/app/api/agents/[id]/playground/route.ts`
**Strategy: Start from main, inject Omar's pause logic into graph section.**

Keep from main:
- `S3Service` + `ContentResolver` + multimodal resolution for simple agents
- `onError` handler in `toUIMessageStreamResponse`
- Enhanced SSE events (`execution_start`, `execution_end`, `ttftMs`, timing metrics)
- `topLevelAttachments` from schema
- `startTime`/`graphStartTime` timing

Add from Omar (into graph section):
- `PausedExecutionService` import
- `let paused = false` flag
- `onPause` callback: `pausedExecService.create()`, `db.agentExecution.update({ status: 'paused' })`
- Guard: only send `execution_end` and update DB to `completed` if `!paused`

---

### Commit 3 — UI Layer

#### `apps/web-ui/hooks/use-playground.ts`
**Strategy: Merge both sets of state additions.**

Hook must export ALL of:
- From Omar: `pauseInfo: PlaygroundPauseInfo | null`, `handleResume: (userInput: string) => Promise<void>`
- From main: `consoleEvents`, `messageMetrics`, `rawDataMap`, `thinkingMap`, `setConsoleEvents`
- Shared: `messages`, `isLoading`, `overrides`, `setOverrides`, `executions`, `refreshExecutions`, `handleSend`, `handleRegenerate`, `setMessages`

Graph stream reader must handle both:
- Omar's pause events (`{ type: 'paused' }` → set `pauseInfo`)
- Main's telemetry events (`execution_start`, `execution_end`, `text_delta`, etc. → populate consoleEvents/metrics)

#### `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx`
**Strategy: Apply both sets of changes to the common ancestor.**

From Omar (different section — message input area):
- `pauseInfo`, `handleResume` destructuring
- `UserCheck` icon import
- Amber HITL banner above ChatInput
- Conditional `ChatInput` handler: `pauseInfo ? handleResume : handleSend`

From main (different section — sidebar/console):
- `useConsole` hook import and destructuring
- `PlaygroundConsole` component
- `UploadedAttachment` type from ChatInput
- `useCallback` import
- Console panel toggle (`PanelRightClose`/`PanelRightOpen`)
- `consoleEvents`/`messageMetrics`/`rawDataMap`/`thinkingMap` destructuring

---

## Testing Strategy

After each commit group, run:
```bash
bun run typecheck          # or: bunx tsc --noEmit
```

After Commit 2 (routes), additionally verify:
- Prisma client generated and compiles: `bunx prisma generate`

After all commits:
```bash
bun install                # regenerates bun.lock
bun run build              # full build verification
```

---

## Rollback Reference

The merge tracking file `docs/dev/changes/2026-06-02-omar-main-merge.md` contains:
- Git SHAs before and after each commit
- Exact changes made to each file
- Revert commands per commit group

---

## Risks

| Risk | Mitigation |
|---|---|
| Graph stream events overlap (pause vs telemetry) | Both event types are distinct strings — parse separately in stream reader |
| `normalizedMessages` type incompatibility in graph path | Cast to common `{ role, content }` before passing to GraphExecutor |
| `PausedExecution` model missing from Prisma client | Run `bunx prisma generate` before touching routes |
| `ContentResolver` not exported from `@chatbot/ai` | Verify main's `libs/ai/src/index.ts` exports it before using in routes |
| `targetCommand` type mismatch | Update `HttpBridgeTransportConfig` interface to `targetCommand?: string` |
