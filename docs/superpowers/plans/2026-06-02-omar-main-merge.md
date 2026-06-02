# Omar ← Main Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge all changes from `bitbucket/main` into `omar-updating-graph-agent`, preserving every feature from both branches (HITL pause/resume + real graph executor from Omar; multimodal, console telemetry, SDK widgets, WhatsApp, Combobox model selector from main).

**Architecture:** Manual cherry-pick approach — no `git merge` (avoids conflict markers). Three commit groups by dependency layer: (1) types/schema/providers, (2) API routes, (3) UI hooks+page. TypeScript check gates each group.

**Tech Stack:** TypeScript strict, Prisma, Next.js 15, Vercel AI SDK v6, `@ai-sdk/openai` v3, `@ai-sdk/amazon-bedrock` v4, Bun monorepo, Nx

---

## File Map

| File | Action | Notes |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `PausedExecution` model to main's schema |
| `libs/shared/src/index.ts` | Modify | Add `PausedExecutionService` exports to main's export list |
| `libs/shared/src/validation/schemas/agents.ts` | Modify | Add attachment schemas; keep `targetCommand` optional |
| `libs/agent-studio/src/types/mcp-server.ts` | Modify | `targetCommand: string` → `targetCommand?: string` |
| `libs/ai/src/providers/bedrock.ts` | Verify | Already correct (Omar's version) — confirm |
| `apps/web-ui/components/llm-providers/provider-model-select.tsx` | Replace | Take main's Combobox version wholesale |
| `apps/workers/tsconfig.json` | Replace | Take main's version (superset of Omar's paths) |
| `.env.example` | Modify | Add `AWS_BEARER_TOKEN_BEDROCK` section from Omar |
| `package.json` | Modify | Add main's missing deps to Omar's package.json |
| `apps/web-ui/app/api/v1/inference/route.ts` | Replace+patch | Take main's file; replace fake graph block with Omar's real executor |
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Replace+patch | Take main's file; add Omar's `PausedExecutionService` + `onPause` callback |
| `apps/web-ui/hooks/use-playground.ts` | Replace+patch | Take main's file; add Omar's `pauseInfo` state + `handleResume` function |
| `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx` | Replace+patch | Take main's file; add Omar's HITL pause banner + `handleResume` wiring |

---

## Task 1: Prisma Schema — Add PausedExecution Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: Read current schema and locate insertion point**

```bash
grep -n "PlaygroundSession\|PausedExecution" prisma/schema.prisma
```

Expected: finds `model PlaygroundSession` — no `PausedExecution` yet (it's only on omar but the current branch already has it since we're ON omar). Verify:

```bash
git show HEAD:prisma/schema.prisma | grep "PausedExecution"
```

If `PausedExecution` is already in the current file (we're on omar branch), skip to Step 1.2 and only verify main's `attachments` field is present.

- [ ] **Step 1.2: Verify main's `attachments` field is in current schema**

```bash
grep -n "attachments" prisma/schema.prisma
```

Expected: `attachments Json?  @default("[]")` in `InferenceSessionMessage` model.

If NOT present, read main's schema section for `InferenceSessionMessage`:
```bash
git show bitbucket/main:prisma/schema.prisma | grep -A 15 "model InferenceSessionMessage"
```

Add the `attachments` field before `tokenCount`:
```prisma
attachments Json?                        @default("[]")
tokenCount  Int?
```

- [ ] **Step 1.3: Verify main's new models are present**

```bash
git show bitbucket/main:prisma/schema.prisma | grep "^model " | sort
grep "^model " prisma/schema.prisma | sort
```

Compare the two lists. Any model in main but not in current branch must be added. Key ones to check: `SdkWidget`, `SdkWidgetVersion`, `MessageFeedback`, `CsatResponse`.

If missing, append from main:
```bash
git show bitbucket/main:prisma/schema.prisma | grep -A 50 "model SdkWidget "
```

Copy each missing model block into `prisma/schema.prisma` before the closing of the file.

- [ ] **Step 1.4: Add missing migration files from main**

```bash
ls prisma/migrations/ | sort
git show bitbucket/main -- --name-only | grep "prisma/migrations" | sort
```

For each migration directory that exists on main but not on the current branch, copy it:
```bash
git show "bitbucket/main:prisma/migrations/20260524000000_readd_document_chunks_embedding/migration.sql" > /tmp/mig1.sql
mkdir -p prisma/migrations/20260524000000_readd_document_chunks_embedding
cp /tmp/mig1.sql prisma/migrations/20260524000000_readd_document_chunks_embedding/migration.sql

git show "bitbucket/main:prisma/migrations/20260524092403_add_sdk_widget_models/migration.sql" > /tmp/mig2.sql
mkdir -p prisma/migrations/20260524092403_add_sdk_widget_models
cp /tmp/mig2.sql prisma/migrations/20260524092403_add_sdk_widget_models/migration.sql

git show "bitbucket/main:prisma/migrations/20260526230109_sync_sdk_widget_indexes/migration.sql" > /tmp/mig3.sql
mkdir -p prisma/migrations/20260526230109_sync_sdk_widget_indexes
cp /tmp/mig3.sql prisma/migrations/20260526230109_sync_sdk_widget_indexes/migration.sql

git show "bitbucket/main:prisma/migrations/20260529000000_add_attachments_to_inference_session_message/migration.sql" > /tmp/mig4.sql
mkdir -p prisma/migrations/20260529000000_add_attachments_to_inference_session_message
cp /tmp/mig4.sql prisma/migrations/20260529000000_add_attachments_to_inference_session_message/migration.sql
```

- [ ] **Step 1.5: Regenerate Prisma client**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot && bunx prisma generate --schema=./prisma/schema.prisma
```

Expected: `Generated Prisma Client` — no errors.

---

## Task 2: Shared Index — Add PausedExecutionService Exports

**Files:**
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 2.1: Take main's index.ts as base**

```bash
git show bitbucket/main:libs/shared/src/index.ts > /tmp/shared_main_index.txt
cat /tmp/shared_main_index.txt
```

- [ ] **Step 2.2: Identify what Omar's branch adds**

```bash
git diff $(git merge-base omar-updating-graph-agent bitbucket/main) omar-updating-graph-agent -- libs/shared/src/index.ts
```

Omar adds these two lines (after `WebhookService`):
```typescript
export { PausedExecutionService } from './services/paused-execution-service';
export type { PausedExecutionRow, CreatePausedExecutionInput } from './services/paused-execution-service';
```

- [ ] **Step 2.3: Add PausedExecutionService exports to main's version**

The current file (on omar branch) already has these lines. Verify main's additions (`SdkWidgetService`, `FeedbackService`, `CsatService`) are present:

```bash
grep -E "SdkWidget|Feedback|Csat" libs/shared/src/index.ts
```

If missing, add after `WebhookService` line:
```typescript
export { SdkWidgetService } from './services/sdk-widget-service';
export type { CreateSdkWidgetInput, SdkWidgetDb } from './services/sdk-widget-service';
export { FeedbackService } from './services/feedback-service';
export type { SubmitFeedbackInput } from './services/feedback-service';
export { CsatService } from './services/csat-service';
export type { SubmitCsatInput } from './services/csat-service';
```

- [ ] **Step 2.4: Verify no duplicate S3Service export**

```bash
grep -c "S3Service" libs/shared/src/index.ts
```

Expected: `1`. If `2`, remove the duplicate line.

---

## Task 3: Validation Schemas — Merge Attachment Schemas

**Files:**
- Modify: `libs/shared/src/validation/schemas/agents.ts`

- [ ] **Step 3.1: Verify targetCommand is optional (keep Omar's)**

```bash
grep "targetCommand" libs/shared/src/validation/schemas/agents.ts
```

Expected: `targetCommand: z.string().optional()` — if it shows `.min(1)` (main's version), change it back to `.optional()`.

- [ ] **Step 3.2: Check if attachment schemas are present**

```bash
grep -n "attachments\|fileId\|s3Key" libs/shared/src/validation/schemas/agents.ts | head -10
```

If NOT present, add main's attachment schema to `playgroundMessageSchema`. Open the file and find `playgroundMessageSchema`. Change from:

```typescript
export const playgroundMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
}).refine((data) => Boolean(data.content || data.parts?.length), {
  message: 'Message content or parts is required',
});
```

To (adding `data` field with attachments):
```typescript
export const playgroundMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  data: z.object({
    attachments: z.array(z.object({
      fileId: z.string(),
      s3Key: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
      size: z.number(),
    })).optional(),
  }).optional(),
}).refine((data) => Boolean(data.content || data.parts?.length), {
  message: 'Message content or parts is required',
});
```

- [ ] **Step 3.3: Add top-level attachments to playgroundRequestSchema**

Find `playgroundRequestSchema` and add `attachments` field if missing:

```typescript
export const playgroundRequestSchema = z.object({
  messages: z.array(playgroundMessageSchema).min(1, 'At least one message is required'),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
  agentVersionId: z.string().optional(),
  alias: z.string().optional(),
  attachments: z.array(z.object({
    fileId: z.string(),
    s3Key: z.string(),
    mimeType: z.string(),
    fileName: z.string(),
    size: z.number(),
  })).optional(),
});
```

- [ ] **Step 3.4: Update createPlaygroundSessionSchema to allow nullable**

Find `createPlaygroundSessionSchema` and update to match main's version:

```typescript
export const createPlaygroundSessionSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  messages: z.array(playgroundSessionMessageSchema).optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional().nullable(),
  agentVersionId: z.string().optional().nullable(),
});
```

---

## Task 4: Fix HttpBridgeTransportConfig Type

**Files:**
- Modify: `libs/agent-studio/src/types/mcp-server.ts`

- [ ] **Step 4.1: Read the interface**

```bash
grep -n "targetCommand\|HttpBridgeTransportConfig" libs/agent-studio/src/types/mcp-server.ts
```

- [ ] **Step 4.2: Make targetCommand optional**

If it shows `targetCommand: string`, change to `targetCommand?: string`.

The interface should read:
```typescript
export interface HttpBridgeTransportConfig {
  bridgeUrl: string;
  targetCommand?: string;
}
```

---

## Task 5: Verify bedrock.ts

**Files:**
- Verify: `libs/ai/src/providers/bedrock.ts`

- [ ] **Step 5.1: Confirm Omar's version is in place**

```bash
grep -n "stepCountIs\|createOpenAI\|mantleClient\|MANTLE_TOOL_PREFIXES" libs/ai/src/providers/bedrock.ts
```

Expected: all four terms found. If any are missing, restore from Omar's branch:
```bash
git show omar-updating-graph-agent:libs/ai/src/providers/bedrock.ts > libs/ai/src/providers/bedrock.ts
```

---

## Task 6: Replace provider-model-select.tsx with Main's Combobox Version

**Files:**
- Replace: `apps/web-ui/components/llm-providers/provider-model-select.tsx`

- [ ] **Step 6.1: Take main's Combobox version**

```bash
git show bitbucket/main:apps/web-ui/components/llm-providers/provider-model-select.tsx > apps/web-ui/components/llm-providers/provider-model-select.tsx
```

- [ ] **Step 6.2: Verify the Combobox UI component exists**

```bash
ls apps/web-ui/components/ui/combobox.tsx
```

If missing:
```bash
git show bitbucket/main:apps/web-ui/components/ui/combobox.tsx > apps/web-ui/components/ui/combobox.tsx
```

- [ ] **Step 6.3: Verify caller interface is unchanged**

```bash
grep -rn "ProviderModelSelect\|provider-model-select" apps/web-ui/ --include="*.tsx" --include="*.ts" | grep -v "^apps/web-ui/components/llm-providers/provider-model-select"
```

For each caller, confirm they pass only: `capability`, `value`, `onChange`, `placeholder`, `disabled` — no other props. The Combobox version accepts the same interface so no changes needed to callers.

---

## Task 7: Merge workers/tsconfig.json

**Files:**
- Replace: `apps/workers/tsconfig.json`

- [ ] **Step 7.1: Take main's tsconfig and add Omar's path aliases**

Main's version already has `exclude: ["**/*.test.ts"]`. Omar's version adds `baseUrl` and `paths` aliases. The merged version needs both. Write:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "../..",
    "paths": {
      "@chatbot/shared": ["libs/shared/src/index.ts"],
      "@chatbot/shared/client": ["libs/shared/src/client.ts"],
      "@chatbot/shared/workers": ["libs/shared/src/workers.ts"],
      "@chatbot/ai": ["libs/ai/src/index.ts"],
      "@chatbot/agent-studio": ["libs/agent-studio/src/index.ts"],
      "@chatbot/agent-studio/server": ["libs/agent-studio/src/server.ts"],
      "@chatbot/knowledge-base": ["libs/knowledge-base/src/index.ts"]
    },
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "sourceMap": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

Note: `noEmit: true` from Omar's version is omitted — main uses a separate `tsconfig.build.json` for builds and this tsconfig should allow emit.

---

## Task 8: Merge .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 8.1: Add AWS_BEARER_TOKEN_BEDROCK section**

The current file (Omar's) has `AWS_BEARER_TOKEN_BEDROCK` in the AWS Bedrock section without a proper comment block. Main's file has the proper comment structure but is missing the bearer token var. Add it into the AWS Bedrock section of the CURRENT file (if it's already there from omar, verify it's present and skip):

```bash
grep "BEARER_TOKEN_BEDROCK" .env.example
```

If found: done. If not found, add after `AWS_SESSION_TOKEN` comment:
```bash
# ============================================================================
# AWS Bedrock Mantle — bearer token for DeepSeek/Kimi tool-calling via mantle
# Generate: aws bedrock create-api-key (or use IAM temporary credentials)
# ============================================================================
# AWS_BEARER_TOKEN_BEDROCK=your-bearer-token
```

- [ ] **Step 8.2: Add WhatsApp and SDK vars from main**

```bash
grep -E "WHATSAPP|SDK_WIDGET|META_" .env.example
```

If missing, check what main adds:
```bash
git show bitbucket/main:.env.example | grep -E "WHATSAPP|SDK_WIDGET|META_|APP_URL"
```

Add any missing sections at the end of the file.

---

## Task 9: Merge package.json Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 9.1: Add main's missing packages to current package.json**

Main has these packages Omar's branch doesn't have:
- `@mozilla/readability`: `^0.6.0`
- `crawlee`: `^3.13.0`
- `jsdom`: `^26.0.0`
- `playwright`: `^1.59.1`
- `puppeteer`: `^25.1.0`
- `turndown`: `^7.2.0`

And dev deps:
- `@stencil/vitest`: `^1.12.1`
- `@types/jsdom`: `^21.7.7`  
- `@types/pdf-parse`: `^1.1.5`
- `@types/turndown`: `^5.0.5`
- `jest-environment-jsdom`: `29`

Also, main has `@ai-sdk/amazon-bedrock: ^4.0.100` but Omar has `^4.0.108` — keep Omar's higher version.

Add the missing packages to `package.json` under `dependencies` and `devDependencies`. Do NOT downgrade any package that Omar's branch has at a higher version.

---

## Task 10: TypeScript Check + Commit 1

- [ ] **Step 10.1: Run TypeScript check**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot && bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | head -50
```

Also check libs:
```bash
bunx tsc --noEmit -p libs/shared/tsconfig.json 2>&1 | head -30
bunx tsc --noEmit -p libs/ai/tsconfig.json 2>&1 | head -30
```

Fix any errors before proceeding. Common issues:
- Missing type imports — add to the appropriate index.ts
- `targetCommand` type mismatch — confirm Task 4 was done

- [ ] **Step 10.2: Stage and commit**

```bash
git add \
  prisma/schema.prisma \
  prisma/migrations/ \
  libs/shared/src/index.ts \
  libs/shared/src/validation/schemas/agents.ts \
  libs/agent-studio/src/types/mcp-server.ts \
  libs/ai/src/providers/bedrock.ts \
  apps/web-ui/components/llm-providers/provider-model-select.tsx \
  apps/web-ui/components/ui/combobox.tsx \
  apps/workers/tsconfig.json \
  .env.example \
  package.json

git commit -m "$(cat <<'EOF'
merge(foundation): bring main's schema, exports, and components into omar branch

- prisma: add PausedExecution model + main's SdkWidget/MessageFeedback/CsatResponse models + attachments field on InferenceSessionMessage
- shared/index: add SdkWidgetService, FeedbackService, CsatService exports alongside PausedExecutionService
- validation/schemas: add attachment sub-schemas to playground request; keep targetCommand optional
- agent-studio/types: make HttpBridgeTransportConfig.targetCommand optional
- bedrock.ts: confirmed Omar's mantle routing + stopWhen:stepCountIs (correct for ai@^6)
- provider-model-select: replace Select with Combobox (same props interface, adds search)
- workers/tsconfig: merge path aliases from Omar + exclude pattern from main
- package.json: add main's missing deps (crawlee, jsdom, readability, etc.)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10.3: Record SHA in tracking file**

```bash
git rev-parse HEAD
```

Update `docs/dev/changes/2026-06-02-omar-main-merge.md` — replace `TBD` under "Commit 1 SHA after" with the actual SHA.

---

## Task 11: inference/route.ts — Take Main's File, Replace Graph Block

**Files:**
- Replace+patch: `apps/web-ui/app/api/v1/inference/route.ts`

- [ ] **Step 11.1: Take main's file as the base**

```bash
git show bitbucket/main:apps/web-ui/app/api/v1/inference/route.ts > apps/web-ui/app/api/v1/inference/route.ts
```

This gives us main's Zod validation, multimodal content normalization, SSE format, and improved non-stream path.

- [ ] **Step 11.2: Add PausedExecutionService to static imports**

Find the import block at the top. Change:
```typescript
import {
  getPrismaClient,
  createLogger,
  QuotaService,
  ResponseCacheService,
  InferenceSessionService,
  LlmProviderService,
  TenantConfigService,
  WebhookService,
  S3Service,
} from '@chatbot/shared';
```

To:
```typescript
import {
  getPrismaClient,
  createLogger,
  QuotaService,
  ResponseCacheService,
  InferenceSessionService,
  LlmProviderService,
  TenantConfigService,
  WebhookService,
  S3Service,
  PausedExecutionService,
} from '@chatbot/shared';
```

- [ ] **Step 11.3: Replace the fake graph simulation with Omar's real executor**

Find the graph agent block — it starts with:
```typescript
// ─── Graph Agent Execution ────────────────────────────────────────────
if (agent.type === 'graph') {
  const graphConfig = config as {
    nodes?: Array<{ id: string; type: string; label: string }>;
    edges?: Array<{ id: string; source: string; target: string }>;
  };
```

And ends before:
```typescript
return new Response(JSON.stringify({ error: 'Unsupported agent type' }), { status: 400 });
```

Replace the ENTIRE graph block (from `// ─── Graph Agent Execution` to just before `return new Response(JSON.stringify({ error: 'Unsupported agent type' }`) with:

```typescript
    // ─── Graph Agent Execution ────────────────────────────────────────────
    if (agent.type === 'graph') {
      const graphConfig = config as { nodes?: any[]; edges?: any[] };
      const graph = { nodes: graphConfig.nodes ?? [], edges: graphConfig.edges ?? [] };

      if (graph.nodes.length === 0) {
        return new Response(
          JSON.stringify({ error: { type: 'agent_not_configured', message: 'Graph has no nodes' } }),
          { status: 400 }
        );
      }

      const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');
      const pausedExecService = new PausedExecutionService(db);

      const llmProviderFn = async (providerId?: string, modelId?: string) => {
        const llmProviderService = new LlmProviderService(tenantId);
        const providerCfg = providerId
          ? await llmProviderService.getConfigById(providerId)
          : modelId
            ? await resolveProviderForModel(tenantId, modelId)
            : null;
        const cfg = providerCfg ?? (await llmProviderService.getDefaultConfig());
        return createLLMProvider(cfg);
      };

      const graphExecutor = new GraphExecutor({ llmProvider: llmProviderFn, prisma: db });
      for (const exec of createNodeExecutors()) graphExecutor.register(exec);

      // Use normalizedMessages (multimodal-aware) stripped to role+content for the graph executor
      const allMessages = sessionId ? [...priorMessages, ...normalizedMessages] : normalizedMessages;
      const inboxMessages = allMessages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const graphStream = new ReadableStream({
        async start(controller) {
          const enc = (data: unknown) =>
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));

          try {
            let paused = false;

            const finalState = await graphExecutor.execute(
              graph,
              { messages: inboxMessages },
              { executionId, agentId, tenantId, userId: '' },
              {
                onEvent: (event) => enc(event),
                onPause: async (pauseInfo) => {
                  paused = true;
                  await pausedExecService.create({
                    tenantId,
                    agentId,
                    executionId,
                    graphState: pauseInfo.state,
                    prompt: pauseInfo.prompt,
                    outputChannel: pauseInfo.outputChannel,
                    nextNodeId: pauseInfo.nextNodeId,
                    resumeToken: pauseInfo.resumeToken,
                  });
                  await db.apiKeyExecution.update({
                    where: { id: executionId },
                    data: { status: 'paused' },
                  });
                },
              }
            );

            if (!paused) {
              const text = String((finalState.channels.__output as string) ?? '');
              const completedAt = new Date();
              await db.apiKeyExecution.update({
                where: { id: executionId },
                data: {
                  status: 'completed',
                  output: { text },
                  completedAt,
                  latencyMs: completedAt.getTime() - startedAt.getTime(),
                },
              });
              if (sessionId) {
                await sessionService.appendMessage(sessionId, { role: 'assistant', content: text });
              }
              await quotaService.incrementUsage(0);
              await deliverWebhook('completed', { text });
              enc({ type: 'done', text });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ executionId, agentId, tenantId, err: msg }, 'graph agent execution failed');
            await db.apiKeyExecution.update({
              where: { id: executionId },
              data: { status: 'failed', error: msg, completedAt: new Date() },
            });
            await deliverWebhook('failed', undefined, msg);
            enc({ type: 'error', message: msg });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(graphStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'x-execution-id': executionId,
          ...(sessionId ? { 'x-session-id': sessionId } : {}),
        },
      });
    }
```

- [ ] **Step 11.4: Verify the file compiles**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "inference/route"
```

Expected: no errors for this file.

---

## Task 12: playground/route.ts — Take Main's File, Add Pause Logic

**Files:**
- Replace+patch: `apps/web-ui/app/api/agents/[id]/playground/route.ts`

- [ ] **Step 12.1: Take main's file as the base**

```bash
git show "bitbucket/main:apps/web-ui/app/api/agents/[id]/playground/route.ts" > "apps/web-ui/app/api/agents/[id]/playground/route.ts"
```

- [ ] **Step 12.2: Add PausedExecutionService to imports**

Find the import from `@chatbot/shared` at the top. Change:
```typescript
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
  LlmProviderService,
  S3Service,
  playgroundRequestSchema,
} from '@chatbot/shared';
```

To:
```typescript
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
  LlmProviderService,
  S3Service,
  PausedExecutionService,
  playgroundRequestSchema,
} from '@chatbot/shared';
```

- [ ] **Step 12.3: Add pause logic to graph section**

In the graph agent block, find the ReadableStream's `start` function. Find this pattern:

```typescript
          let fullText = '';
          const graphStartTime = Date.now();
          let graphTtftMs: number | undefined;

          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();

              const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
              };

              sendEvent('execution_start', {
```

After `let graphTtftMs: number | undefined;` and before `const stream = new ReadableStream`, add:

```typescript
          let paused = false;
          const pausedExecService = new PausedExecutionService(db);
```

- [ ] **Step 12.4: Add onPause callback to executor.execute call**

Find `executor.execute(` in the graph section. It currently ends with:
```typescript
              {
                onEvent: (event) => {
                  if (event.type === 'text_delta' && graphTtftMs === undefined) {
                    graphTtftMs = Date.now() - graphStartTime;
                  }
                  sendEvent(event.type, event);
                  if (event.type === 'text_delta') {
                    fullText += event.delta;
                  }
                },
              }
            );
```

Change to:
```typescript
              {
                onEvent: (event) => {
                  if (event.type === 'text_delta' && graphTtftMs === undefined) {
                    graphTtftMs = Date.now() - graphStartTime;
                  }
                  sendEvent(event.type, event);
                  if (event.type === 'text_delta') {
                    fullText += (event as any).delta;
                  }
                },
                onPause: async (pauseInfo) => {
                  paused = true;
                  await pausedExecService.create({
                    tenantId,
                    agentId: id,
                    executionId: execution.id,
                    graphState: pauseInfo.state,
                    prompt: pauseInfo.prompt,
                    outputChannel: pauseInfo.outputChannel,
                    nextNodeId: pauseInfo.nextNodeId,
                    resumeToken: pauseInfo.resumeToken,
                  });
                  await db.agentExecution.update({
                    where: { id: execution.id },
                    data: { status: 'paused' },
                  });
                  sendEvent('execution_paused', {
                    resumeToken: pauseInfo.resumeToken,
                    prompt: pauseInfo.prompt,
                  });
                  logger.info({ executionId: execution.id, resumeToken: pauseInfo.resumeToken }, 'Playground execution paused at human node');
                },
              }
            );
```

- [ ] **Step 12.5: Guard execution_end and DB completion with !paused**

Find the code block after the executor.execute call that sends `execution_end` and updates DB to `completed`:

```typescript
            const durationMs = Date.now() - graphStartTime;
            sendEvent('execution_end', {
              usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
              durationMs,
              ttftMs: graphTtftMs ?? durationMs,
              model: 'graph',
            });

            await db.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: 'completed',
                output: { text: fullText },
                completedAt: new Date(),
              },
            });
```

Wrap it with `if (!paused) {`:

```typescript
            if (!paused) {
              const durationMs = Date.now() - graphStartTime;
              sendEvent('execution_end', {
                usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
                durationMs,
                ttftMs: graphTtftMs ?? durationMs,
                model: 'graph',
              });

              await db.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'completed',
                  output: { text: fullText },
                  completedAt: new Date(),
                },
              });
            }
```

- [ ] **Step 12.6: TypeScript check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "playground/route\|inference/route" | head -20
```

Fix any errors. Common: `onPause` may not be in the `GraphExecutorCallbacks` type — check:
```bash
grep -n "onPause\|GraphExecutorCallbacks\|execute(" libs/agent-studio/src/execution/graph-executor.ts | head -20
```

If `onPause` is not in the type definition, add it. The type should accept an optional `onPause` callback.

---

## Task 13: TypeScript Check + Commit 2

- [ ] **Step 13.1: Full TypeScript check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | head -60
```

Resolve all errors before committing.

- [ ] **Step 13.2: Commit**

```bash
git add \
  "apps/web-ui/app/api/v1/inference/route.ts" \
  "apps/web-ui/app/api/agents/[id]/playground/route.ts"

git commit -m "$(cat <<'EOF'
merge(routes): combine multimodal inference with real graph executor + HITL pause

inference/route.ts:
- take main's Zod validation, S3/ContentResolver multimodal normalization, SSE format
- replace fake graph simulation with Omar's real GraphExecutor + PausedExecutionService
- graph uses normalizedMessages (multimodal-aware) stripped to role+content

playground/route.ts:
- take main's multimodal simple-agent path, onError handler, SSE timing events
- add PausedExecutionService + onPause callback to graph executor
- guard execution_end and DB completion with !paused check
- emit execution_paused SSE event so client can show HITL prompt

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 13.3: Record SHA**

```bash
git rev-parse HEAD
```

Update tracking file with Commit 2 SHA.

---

## Task 14: use-playground.ts — Take Main's File, Add Pause State + handleResume

**Files:**
- Replace+patch: `apps/web-ui/hooks/use-playground.ts`

- [ ] **Step 14.1: Take main's file as the base**

```bash
git show "bitbucket/main:apps/web-ui/hooks/use-playground.ts" > apps/web-ui/hooks/use-playground.ts
```

This gives us console telemetry state (`consoleEvents`, `messageMetrics`, `rawDataMap`, `thinkingMap`), `graphMessages`/`setGraphMessages` split, and the comprehensive graph stream reader.

- [ ] **Step 14.2: Add PlaygroundPauseInfo interface**

After the `PlaygroundMessage` interface, add:

```typescript
export interface PlaygroundPauseInfo {
  prompt: string;
  resumeToken: string;
  executionId: string;
}
```

- [ ] **Step 14.3: Add pauseInfo state**

Inside `usePlayground`, after `const [thinkingMap, setThinkingMap] = useState...`, add:

```typescript
  const [pauseInfo, setPauseInfo] = useState<PlaygroundPauseInfo | null>(null);
```

- [ ] **Step 14.4: Reset pauseInfo at start of graph handleSend**

In `handleSend`, find where the graph path begins (after `if (agentType === 'simple')` returns). Add `setPauseInfo(null)` after `setIsGraphLoading(true)`:

```typescript
      // Graph agent: SSE streaming with console event capture
      setIsGraphLoading(true);
      setPauseInfo(null);
```

- [ ] **Step 14.5: Add execution_paused detection in graph stream reader**

In `handleSend`, inside the SSE parsing loop, find the `else if (pendingEventType === 'execution_end')` block. After it, add:

```typescript
                } else if (pendingEventType === 'execution_paused' && typeof data.resumeToken === 'string' && executionId) {
                  const info: PlaygroundPauseInfo = {
                    prompt: (data.prompt as string) ?? '',
                    resumeToken: data.resumeToken,
                    executionId,
                  };
                  setPauseInfo(info);
```

- [ ] **Step 14.6: Add handleResume function**

Add this function after `handleSend`, before `handleRegenerate`:

```typescript
  const handleResume = useCallback(
    async (userInput: string) => {
      if (!pauseInfo) return;
      setIsGraphLoading(true);

      const userMessage: PlaygroundMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text' as const, text: userInput }],
      };
      setGraphMessages((prev) => [...prev, userMessage]);
      const capturedPauseInfo = pauseInfo;
      setPauseInfo(null);

      const resumeMessageId = crypto.randomUUID();
      let resumeText = '';
      const rawSseLines: string[] = [];
      const resumeStartTime = Date.now();
      let resumeTtftMs: number | undefined;

      try {
        const res = await fetch(`/api/agents/${agentId}/playground/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeToken: capturedPauseInfo.resumeToken,
            userInput,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? 'Failed to resume agent');
        }

        const executionId = res.headers.get('x-execution-id') ?? undefined;

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let pendingEventType = '';
          for (const line of lines) {
            rawSseLines.push(line);
            if (line.startsWith('event: ')) {
              pendingEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && pendingEventType) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
                const relativeMs = Date.now() - resumeStartTime;

                setConsoleEvents((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    messageId: resumeMessageId,
                    timestamp: Date.now(),
                    relativeMs,
                    severity: pendingEventType === 'error' ? ('error' as const) : ('info' as const),
                    type: pendingEventType,
                    data,
                  },
                ]);

                if (pendingEventType === 'text_delta' && typeof data.delta === 'string') {
                  if (resumeTtftMs === undefined) resumeTtftMs = relativeMs;
                  resumeText += data.delta;
                  setGraphMessages((prev) => {
                    const existing = prev.find((m) => m.id === resumeMessageId);
                    if (existing) {
                      return prev.map((m) =>
                        m.id === resumeMessageId
                          ? { ...m, parts: [{ type: 'text' as const, text: resumeText }] }
                          : m
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: resumeMessageId,
                        role: 'assistant' as const,
                        parts: [{ type: 'text' as const, text: resumeText }],
                        executionId,
                      },
                    ];
                  });
                } else if (pendingEventType === 'execution_paused' && typeof data.resumeToken === 'string' && executionId) {
                  setPauseInfo({
                    prompt: (data.prompt as string) ?? '',
                    resumeToken: data.resumeToken,
                    executionId,
                  });
                } else if (pendingEventType === 'execution_end') {
                  const usage = (data.usage as { inputTokens?: number; outputTokens?: number; thinkingTokens?: number }) ?? {};
                  const model = (data.model as string) ?? 'unknown';
                  setMessageMetrics((prev) => {
                    const next = new Map(prev);
                    next.set(resumeMessageId, {
                      messageId: resumeMessageId,
                      inputTokens: usage.inputTokens ?? 0,
                      outputTokens: usage.outputTokens ?? 0,
                      thinkingTokens: usage.thinkingTokens ?? 0,
                      totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0),
                      ttftMs: resumeTtftMs ?? 0,
                      durationMs: (data.durationMs as number) ?? Date.now() - resumeStartTime,
                      model,
                      costEstimate: calculateCost(model, {
                        inputTokens: usage.inputTokens ?? 0,
                        outputTokens: usage.outputTokens ?? 0,
                        thinkingTokens: usage.thinkingTokens,
                      }),
                    });
                    return next;
                  });
                }
              } catch {
                // skip malformed events
              }
              pendingEventType = '';
            } else {
              if (line === '') pendingEventType = '';
            }
          }
        }

        setRawDataMap((prev) => {
          const next = new Map(prev);
          next.set(resumeMessageId, {
            request: {
              method: 'POST',
              url: `/api/agents/${agentId}/playground/resume`,
              headers: { 'Content-Type': 'application/json' },
              body: { resumeToken: capturedPauseInfo.resumeToken, userInput },
            },
            response: { status: res.status, headers: {} },
            sseStream: rawSseLines,
          });
          return next;
        });

        if (resumeText) {
          setGraphMessages((prev) => {
            if (prev.find((m) => m.id === resumeMessageId)) return prev;
            return [
              ...prev,
              {
                id: resumeMessageId,
                role: 'assistant' as const,
                parts: [{ type: 'text' as const, text: resumeText }],
                executionId,
              },
            ];
          });
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsGraphLoading(false);
      }
    },
    [pauseInfo, agentId, setGraphMessages, setConsoleEvents, setMessageMetrics, setRawDataMap, onError]
  );
```

- [ ] **Step 14.7: Add pauseInfo and handleResume to the return object**

Find the `return {` at the bottom of the hook. Add `pauseInfo` and `handleResume`:

```typescript
  return {
    messages,
    isLoading,
    pauseInfo,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleResume,
    handleRegenerate,
    setMessages,
    // Console data
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
    setConsoleEvents,
  };
```

---

## Task 15: playground/page.tsx — Take Main's File, Add HITL Pause UI

**Files:**
- Replace+patch: `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx`

- [ ] **Step 15.1: Take main's file as base**

```bash
git show "bitbucket/main:apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx" > "apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx"
```

- [ ] **Step 15.2: Add UserCheck icon import**

Find the lucide-react import block. Add `UserCheck` to it:

```typescript
import {
  ArrowLeft,
  Save,
  Trash2,
  Loader2,
  Bot,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  UserCheck,
} from 'lucide-react';
```

- [ ] **Step 15.3: Add pauseInfo and handleResume to usePlayground destructuring**

Find the `usePlayground` destructuring block:

```typescript
  const {
    messages,
    isLoading,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleRegenerate,
    setMessages,
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
  } = usePlayground({
```

Change to:

```typescript
  const {
    messages,
    isLoading,
    pauseInfo,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleResume,
    handleRegenerate,
    setMessages,
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
  } = usePlayground({
```

- [ ] **Step 15.4: Add HITL pause banner and wire handleResume to ChatInput**

Find the `<ChatInput` line in the JSX. It currently reads:

```tsx
          <ChatInput onSend={handleSend} isLoading={isLoading} uploadFile={uploadFile} />
```

Replace with:

```tsx
          {pauseInfo && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="font-medium text-amber-900 dark:text-amber-200">Agent waiting for your input</p>
                {pauseInfo.prompt && (
                  <p className="mt-0.5 text-amber-700 dark:text-amber-300">{pauseInfo.prompt}</p>
                )}
              </div>
            </div>
          )}
          <ChatInput
            onSend={pauseInfo ? handleResume : handleSend}
            isLoading={isLoading}
            uploadFile={pauseInfo ? undefined : uploadFile}
          />
```

Note: `uploadFile` is set to `undefined` during pause because file uploads are not applicable to resume inputs.

- [ ] **Step 15.5: TypeScript check for page**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "playground/page\|use-playground" | head -20
```

Fix any type errors. Common: `handleResume` signature expects `(userInput: string)` — `ChatInput.onSend` must accept a string. Verify `ChatInput` prop type:

```bash
grep -n "onSend" apps/web-ui/components/chat/chat-input.tsx | head -5
```

If `ChatInput.onSend` has a signature incompatible with `handleResume`, add an adapter:

```tsx
onSend={pauseInfo ? (content: string) => handleResume(content) : handleSend}
```

---

## Task 16: Final Verification + bun install + Commit 3

- [ ] **Step 16.1: Full TypeScript check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | head -80
bunx tsc --noEmit -p libs/shared/tsconfig.json 2>&1 | head -20
bunx tsc --noEmit -p libs/ai/tsconfig.json 2>&1 | head -20
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json 2>&1 | head -20
```

All must pass with 0 errors before committing.

- [ ] **Step 16.2: Regenerate bun.lock**

```bash
bun install
```

- [ ] **Step 16.3: Commit**

```bash
git add \
  apps/web-ui/hooks/use-playground.ts \
  "apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx" \
  bun.lock

git commit -m "$(cat <<'EOF'
merge(ui): add HITL pause/resume to main's console-telemetry playground

use-playground.ts:
- take main's version (consoleEvents, messageMetrics, rawDataMap, thinkingMap, graphMessages split)
- add PlaygroundPauseInfo interface + pauseInfo state
- detect execution_paused SSE events in graph stream reader
- add handleResume that processes resume stream with full console telemetry
- export pauseInfo and handleResume alongside main's console data exports

playground/page.tsx:
- take main's version (PlaygroundConsole, useConsole, file upload, console panel toggle)
- add pauseInfo + handleResume destructuring from usePlayground
- add amber HITL banner above ChatInput when agent is paused
- route ChatInput.onSend to handleResume when paused, handleSend otherwise

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 16.4: Record final SHA and update tracking file**

```bash
git rev-parse HEAD
git log --oneline -5
```

Update `docs/dev/changes/2026-06-02-omar-main-merge.md`:
- Fill in all `TBD` SHA fields
- Set `Status: COMPLETE`

- [ ] **Step 16.5: Commit the tracking file**

```bash
git add docs/dev/changes/2026-06-02-omar-main-merge.md docs/superpowers/specs/2026-06-02-omar-main-merge-design.md docs/superpowers/plans/2026-06-02-omar-main-merge.md
git commit -m "docs: add merge tracking file and spec for omar←main merge"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `prisma/schema.prisma` — Tasks 1.1–1.5
- [x] `libs/shared/src/index.ts` — Task 2
- [x] `libs/shared/src/validation/schemas/agents.ts` — Task 3
- [x] `libs/agent-studio/src/types/mcp-server.ts` — Task 4
- [x] `libs/ai/src/providers/bedrock.ts` — Task 5 (verify only)
- [x] `apps/web-ui/components/llm-providers/provider-model-select.tsx` — Task 6
- [x] `apps/workers/tsconfig.json` — Task 7
- [x] `.env.example` — Task 8
- [x] `package.json` — Task 9
- [x] TypeScript gate — Tasks 10, 13, 16
- [x] `inference/route.ts` — Task 11
- [x] `playground/route.ts` — Task 12
- [x] `use-playground.ts` — Task 14
- [x] `playground/page.tsx` — Task 15
- [x] `bun.lock` — Task 16.2
- [x] Tracking file — Task 16.4–16.5

**Key invariants confirmed:**
- `stopWhen: stepCountIs()` not `maxSteps` — AI SDK v6 correct API
- `createOpenAI` + `.chat()` — correct for bedrock-mantle
- `targetCommand` optional — runtime never reads it, form treats as optional
- Combobox props interface identical to Select — no caller changes needed
- `PausedExecution` Prisma model required before routes compile
- `handleResume` in use-playground uses `graphMessages`/`setGraphMessages` (main's split) not the AI SDK messages
