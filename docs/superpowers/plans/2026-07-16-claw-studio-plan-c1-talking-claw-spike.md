# Claw Studio — Plan C1: "Talking Claw" Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the Claw chat spine end-to-end — an in-process LangGraph agent, driven by the tenant's existing `LlmProvider`, streaming a reply into Mission Control's `/chat` — and settle the CopilotKit-vs-SSE transport question with a real spike.

**Architecture:** New Nx lib `libs/claw-studio` holds Claw's brain: a bridge that turns this repo's resolved `LlmProvider` config into a LangChain chat model, and a minimal one-node LangGraph `StateGraph`. Mission Control gets an in-process API route that runs the compiled graph and streams its output. The frontend transport is decided by **Task 5 (the spike)**: attempt **shape #2** (CopilotKit UI ↔ the in-process graph via a custom AG-UI agent); if it fights us, fall back to **shape #1** (a shadcn chat UI over the SSE route — the proven `nucleus-cloud-ops` pattern). Either way the graph runs in-process in one app; no separate LangGraph server.

**Tech Stack:** `@langchain/langgraph`, `@langchain/core`, `@langchain/aws` (Bedrock), `@langchain/openai`/`@langchain/anthropic`, bridged to this repo's `LlmProviderService`; Next 15 API route; CopilotKit (spike) or shadcn+SSE (fallback).

## Global Constraints

- **Reuse, don't reinvent, provider resolution:** get the tenant's model/credentials via `LlmProviderService.getDefaultConfig()` / `getConfigById()` (already decrypts via `EncryptionService`, keyed by `ENCRYPTION_KEY`). Do NOT re-implement credential handling.
- **The graph owns its LLM calls** via LangChain chat models; nothing else calls the model.
- **In-process only:** the compiled `StateGraph` runs inside a Next.js route in `apps/mission-control` — no separate LangGraph server, no LangGraph Platform.
- **Heavy deps live in `libs/claw-studio` + `apps/mission-control` only** — never added to `web-ui` or `libs/shared`.
- **Dependency layout:** LangChain packages go in the ROOT `package.json` dependencies (where framework/runtime deps live in this hybrid Bun workspace); `libs/claw-studio` re-declares only what an Nx lib needs. CopilotKit UI packages (if Task 5 keeps them) go in `apps/mission-control/package.json`.
- **Standards:** Zod at API boundaries; T3 Env for new env vars (no direct `process.env`); try/catch + Pino (`createLogger`) in the route and service code; shadcn/ui for any custom UI; typed params (no implicit `any`).
- **Nx conventions:** `libs/claw-studio` mirrors `libs/agent-studio` (`nx:run-commands` test/typecheck targets, `@nx/js:tsc` build). Add `claw-studio` to the root `typecheck` `-p` list.
- **Spike honesty (Task 5):** do not fake a working chat. The success gate is an observed streamed reply in the browser. If shape #2 doesn't come together within the task, report DONE_WITH_CONCERNS and implement the shape-#1 fallback rather than committing broken glue.

---

### Task 1: Scaffold `libs/claw-studio` + LangChain dependencies

**Files:**
- Create: `libs/claw-studio/{project.json, package.json, tsconfig.json, tsconfig.lib.json, tsconfig.spec.json, vitest.config.ts, src/index.ts}`
- Modify: root `package.json` (add LangChain deps + `claw-studio` to the `typecheck` `-p` list)
- Modify: `tsconfig.base.json` (add `@chatbot/claw-studio` path alias)

**Interfaces:**
- Produces: an importable Nx lib `@chatbot/claw-studio` (path alias `@chatbot/claw-studio` → `libs/claw-studio/src/index.ts`), with `@langchain/*` resolvable.

- [ ] **Step 1: Mirror agent-studio's lib config**

Read these files from `libs/agent-studio/` and write adapted copies into `libs/claw-studio/` (change every `agent-studio` → `claw-studio` and the Nx project `name` to `claw-studio`): `project.json`, `package.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `vitest.config.ts`. Do NOT invent a new structure — match agent-studio's exactly (it already uses the `nx:run-commands` `test`/`typecheck` targets and `@nx/js:tsc` build that this repo requires).

Create `libs/claw-studio/src/index.ts` with a placeholder export:

```ts
export const CLAW_STUDIO_LIB = 'claw-studio';
```

- [ ] **Step 2: Add the path alias**

In `tsconfig.base.json` `compilerOptions.paths`, add (after the `@chatbot/agent-studio` entries):

```json
    "@chatbot/claw-studio": ["libs/claw-studio/src/index.ts"],
```

- [ ] **Step 3: Add LangChain deps to the root package.json**

In the root `package.json` `dependencies`, add (versions matched to the `nucleus-cloud-ops` reference which runs the same stack):

```json
    "@langchain/core": "^1.1.39",
    "@langchain/langgraph": "^1.3.0",
    "@langchain/aws": "^1.3.0",
    "@langchain/openai": "^1.3.0",
    "@langchain/anthropic": "^1.5.1",
    "langchain": "^1.2.28",
```

- [ ] **Step 4: Add claw-studio to the typecheck aggregate**

In the root `package.json`, append `,claw-studio` to the `typecheck` script's `-p` list.

- [ ] **Step 5: Install + verify**

Run: `bun install`
Then: `bunx nx typecheck claw-studio` → no errors.
Then: `bunx nx build claw-studio` → success (emits `dist/libs/claw-studio`).
Then confirm LangChain resolves: `cd libs/claw-studio && bunx tsc --noEmit -e "import { StateGraph } from '@langchain/langgraph'; void StateGraph;" 2>/dev/null; echo ok` (or a tiny temp file importing it, then delete).

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio tsconfig.base.json package.json bun.lock
git commit -m "feat(claw-studio): scaffold libs/claw-studio lib with LangChain deps"
```

---

### Task 2: Model bridge — `LlmProvider` config → LangChain chat model

**Files:**
- Create: `libs/claw-studio/src/agent/model-factory.ts`
- Test: `libs/claw-studio/src/agent/model-factory.test.ts`
- Modify: `libs/claw-studio/src/index.ts` (export `createClawModel`, `ClawModelConfig`)

**Interfaces:**
- Consumes: a resolved provider config shaped like what `LlmProviderService.getDefaultConfig()` returns: `{ provider: string; chatModel?: string; region?: string; baseUrl?: string; apiKey?: string; accessKeyId?: string; secretAccessKey?: string }`.
- Produces: `createClawModel(config: ClawModelConfig): BaseChatModel` (from `@langchain/core/language_models/chat_models`).

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/model-factory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { createClawModel } from './model-factory';

describe('createClawModel', () => {
  it('builds a Bedrock model for provider "bedrock"', () => {
    const model = createClawModel({
      provider: 'bedrock', chatModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      region: 'ap-south-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    });
    expect(model).toBeInstanceOf(ChatBedrockConverse);
  });

  it('builds an Anthropic model for provider "anthropic"', () => {
    const model = createClawModel({ provider: 'anthropic', chatModel: 'claude-3-5', apiKey: 'sk-x' });
    expect(model).toBeInstanceOf(ChatAnthropic);
  });

  it('builds an OpenAI-compatible model for provider "openai_compatible"', () => {
    const model = createClawModel({ provider: 'openai_compatible', chatModel: 'llama3', baseUrl: 'http://localhost:1234/v1' });
    expect(model).toBeInstanceOf(ChatOpenAI);
  });

  it('throws a typed error when chatModel is missing', () => {
    expect(() => createClawModel({ provider: 'bedrock' })).toThrow(/chatModel/i);
  });
});
```

- [ ] **Step 2: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/model-factory.test.ts`
Expected: FAIL — cannot find `./model-factory`.

- [ ] **Step 3: Implement**

Create `libs/claw-studio/src/agent/model-factory.ts`:

```ts
import { ChatBedrockConverse } from '@langchain/aws';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ClawModelConfig {
  provider: string;
  chatModel?: string;
  region?: string;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  maxTokens?: number;
  temperature?: number;
}

const OPENAI_COMPATIBLE = new Set(['openai', 'openai_compatible', 'ollama', 'vllm', 'litellm', 'lmstudio']);

export function createClawModel(config: ClawModelConfig): BaseChatModel {
  const model = config.chatModel;
  if (!model) {
    throw new Error('createClawModel: chatModel is required on the provider config');
  }
  const maxTokens = config.maxTokens ?? 4096;

  if (config.provider === 'bedrock') {
    return new ChatBedrockConverse({
      region: config.region,
      model,
      maxTokens,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    });
  }

  if (config.provider === 'anthropic') {
    return new ChatAnthropic({
      model,
      apiKey: config.apiKey,
      maxTokens,
      ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
    });
  }

  if (OPENAI_COMPATIBLE.has(config.provider)) {
    return new ChatOpenAI({
      model,
      maxTokens,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey ?? 'not-needed' },
    });
  }

  throw new Error(`createClawModel: unsupported provider "${config.provider}"`);
}
```

- [ ] **Step 4: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { createClawModel } from './agent/model-factory';
export type { ClawModelConfig } from './agent/model-factory';
```

Run: `cd libs/claw-studio && bunx vitest run src/agent/model-factory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src package.json
git commit -m "feat(claw-studio): bridge LlmProvider config to LangChain chat models"
```

---

### Task 3: Minimal Claw graph — single LLM node

**Files:**
- Create: `libs/claw-studio/src/agent/claw-graph.ts`
- Test: `libs/claw-studio/src/agent/claw-graph.test.ts`
- Modify: `libs/claw-studio/src/index.ts` (export `createClawGraph`)

**Interfaces:**
- Consumes: a `BaseChatModel` (from Task 2).
- Produces: `createClawGraph(deps: { model: BaseChatModel; systemPrompt?: string })` → a compiled LangGraph graph whose state is `MessagesAnnotation` and whose single node invokes the model.

- [ ] **Step 1: Write the failing test** (uses LangChain's built-in fake model — no network)

Create `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { createClawGraph } from './claw-graph';

describe('createClawGraph', () => {
  it('routes a user message through the model node and returns the reply', async () => {
    const model = new FakeListChatModel({ responses: ['Hello from Claw'] });
    const graph = createClawGraph({ model });
    const result = await graph.invoke({ messages: [new HumanMessage('hi')] });
    const last = result.messages[result.messages.length - 1];
    expect(String(last.content)).toContain('Hello from Claw');
  });

  it('prepends the system prompt when provided', async () => {
    const model = new FakeListChatModel({ responses: ['ok'] });
    const graph = createClawGraph({ model, systemPrompt: 'You are Claw.' });
    const result = await graph.invoke({ messages: [new HumanMessage('hi')] });
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: FAIL — cannot find `./claw-graph`.

- [ ] **Step 3: Implement**

Create `libs/claw-studio/src/agent/claw-graph.ts`:

```ts
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ClawGraphDeps {
  model: BaseChatModel;
  systemPrompt?: string;
}

export function createClawGraph(deps: ClawGraphDeps) {
  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const messages = deps.systemPrompt
      ? [new SystemMessage(deps.systemPrompt), ...state.messages]
      : state.messages;
    const response = await deps.model.invoke(messages);
    return { messages: [response] };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode('claw', callModel)
    .addEdge(START, 'claw')
    .addEdge('claw', END)
    .compile();
}
```

- [ ] **Step 4: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { createClawGraph } from './agent/claw-graph';
export type { ClawGraphDeps } from './agent/claw-graph';
```

Run: `cd libs/claw-studio && bunx vitest run` → all tests pass.
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): minimal single-node Claw LangGraph graph"
```

---

### Task 4: In-process streaming route in Mission Control + prove the graph runs

**Files:**
- Create: `libs/claw-studio/src/agent/claw-runtime.ts` (resolve provider → model → graph for a tenant)
- Modify: `libs/claw-studio/src/index.ts`
- Create: `apps/mission-control/app/api/chat/route.ts` (in-process graph, SSE stream)
- Modify: `apps/mission-control/package.json` (add `@chatbot/claw-studio` + LangChain resolve — verify) and `apps/mission-control/tsconfig.json` (add `@chatbot/claw-studio` alias)

**Interfaces:**
- Consumes: the Studio session (`session.studio.{tenantId,clawId}`), `LlmProviderService`, `createClawModel`, `createClawGraph`.
- Produces:
  - `resolveClawGraph(tenantId: string)` in `claw-runtime.ts`: loads the tenant's default `LlmProvider` config, builds the model + graph; throws a typed error if no provider is configured.
  - `POST /api/chat` in mission-control: body `{ message: string }` (Zod-validated), streams the assistant reply as SSE `text/event-stream` (`event: token` / `event: done`).

- [ ] **Step 1: `claw-runtime.ts`**

```ts
import { LlmProviderService, createLogger } from '@chatbot/shared';
import { createClawModel } from './model-factory';
import { createClawGraph } from './claw-graph';

const logger = createLogger('claw-studio:runtime');

export async function resolveClawGraph(tenantId: string, systemPrompt?: string) {
  const config = await new LlmProviderService(tenantId).getDefaultConfig();
  if (!config) {
    throw new Error('No LLM provider configured for this tenant');
  }
  logger.info({ tenantId, provider: config.provider, model: config.chatModel }, 'Resolved Claw model');
  const model = createClawModel(config);
  return createClawGraph({ model, systemPrompt });
}
```

Export `resolveClawGraph` from `libs/claw-studio/src/index.ts`. Add the `@chatbot/claw-studio` alias to `apps/mission-control/tsconfig.json` paths and add `@chatbot/claw-studio` to its `transpilePackages` in `next.config.ts` (plus the `@langchain/*` packages that must transpile — verify by build).

- [ ] **Step 2: SSE chat route**

Create `apps/mission-control/app/api/chat/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { resolveClawGraph } from '@chatbot/claw-studio';
import { HumanMessage } from '@langchain/core/messages';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:chat');
const bodySchema = z.object({ message: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 });
    }

    const graph = await resolveClawGraph(session.studio.tenantId, 'You are Claw, an autonomous teammate.');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const events = await graph.stream(
            { messages: [new HumanMessage(parsed.data.message)] },
            { streamMode: 'messages' },
          );
          for await (const [chunk] of events as AsyncIterable<[{ content: unknown }]>) {
            const text = typeof chunk.content === 'string' ? chunk.content : '';
            if (text) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(text)}\n\n`));
          }
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        } catch (err) {
          logger.error({ err }, 'Claw stream failed');
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(String(err))}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    logger.error({ error }, 'Chat route failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

> `streamMode: 'messages'` yields `[messageChunk, metadata]` tuples for token streaming; confirm the tuple shape against the installed `@langchain/langgraph` version during implementation and adjust the destructuring if needed.

- [ ] **Step 3: Verify build + typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Run: `bunx nx build mission-control` → success.

- [ ] **Step 4: Prove the graph runs (environment-dependent)**

If a tenant with a configured Bedrock `LlmProvider` and valid AWS credentials is available in this environment: seed/log in, `curl -N` the route with a Studio session cookie and a `{ "message": "say hi" }` body, and confirm `event: token` frames stream a real reply. Record the transcript.

If live Bedrock is NOT reachable here (no creds / no provider configured): this is an environment limit, not a code defect. Report DONE_WITH_CONCERNS, and instead prove the wiring with a unit/integration test that calls `resolveClawGraph` with a mocked `LlmProviderService.getDefaultConfig` returning a config, and a `createClawModel` swapped for `FakeListChatModel` via the graph, asserting the SSE stream emits `token` then `done`. State clearly which verification path was taken.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src apps/mission-control
git commit -m "feat(mission-control): in-process Claw graph SSE chat route"
```

---

### Task 5: The spike — CopilotKit UI ↔ in-process graph (shape #2), with shape-#1 fallback

**Files (shape #2 attempt):**
- Modify: `apps/mission-control/package.json` (add `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/runtime`, `@ag-ui/*` as needed — pin exact versions)
- Create: `apps/mission-control/app/api/copilotkit/route.ts` (CopilotRuntime + a custom AG-UI agent wrapping the in-process graph)
- Modify: `apps/mission-control/app/(console)/chat/page.tsx` (replace the stub with the chat UI)
- Modify: `apps/mission-control/app/layout.tsx` (mount `<CopilotKit>` if shape #2)

**This task is a SPIKE. Timebox it. The deliverable is a decision + a working chat, not necessarily CopilotKit.**

- [ ] **Step 1: Establish the current CopilotKit API (don't trust stale docs)**

Run `npx copilotkit@latest create` in a throwaway temp dir (outside the repo) and read the scaffolded `app/api/copilotkit/route.ts` + provider setup — the research established the docs are mid-migration and the CLI output is the reliable source of truth for the current call shape (`LangGraphAgent` vs `langGraphPlatformEndpoint`, `useAgent` vs `useCoAgent`). Note the exact imports/versions.

- [ ] **Step 2: Attempt the in-process bridge**

The turnkey `LangGraphAgent`/`langGraphPlatformEndpoint` adapters require a `deploymentUrl` (separate server) — do NOT use them. Instead, implement a custom agent for `CopilotRuntime` (via the `@ag-ui/*` `AbstractAgent` / custom-agent extension point) that runs the compiled graph from `resolveClawGraph(tenantId)` in-process and emits AG-UI events from `graph.stream(...)`. Wire `/api/copilotkit` to it, mount `<CopilotKit runtimeUrl="/api/copilotkit" agent="claw">` in the layout, and render `<CopilotChat>` (or a custom shadcn chat bound to `useAgent`/`useCoAgent`) in `/chat`.

**Success gate:** logged into Mission Control, typing a message in `/chat` streams a real Claw reply in the browser (tenant's Bedrock), no separate server running. Verify by driving the browser.

- [ ] **Step 3: Decision gate**

- If Step 2 succeeds cleanly → keep shape #2. Note the exact working package versions + integration approach in the module CLAUDE.md (Task 6-of-a-later-plan) and commit.
- If Step 2 fights (the custom AG-UI/in-process path is undocumented and the glue is fragile, or CopilotKit's UI can't be made shadcn-compliant acceptably) → **STOP, do not commit broken glue.** Report the specific blocker, then implement the **shape-#1 fallback**: a shadcn chat page (`components/ui`-based message list + input) that POSTs to the Task 4 `/api/chat` SSE route and renders streamed tokens with a small `useClawChat` hook. This is proven and fully in our control.

- [ ] **Step 4: Commit the chosen shape**

```bash
git add apps/mission-control package.json bun.lock
git commit -m "feat(mission-control): Chat with Claw — <shape #2 CopilotKit | shape #1 shadcn SSE>"
```

Record which shape shipped and why in the report.

---

## Self-Review

**Spec coverage (Plan C1 slice):** the CopilotKit↔LangGraph spike (spec §7 "implementation step #1") → Task 5; the LlmProvider bridge (spec §5/§8) → Task 2; the LangGraph graph (spec §7) → Tasks 3–4; `libs/claw-studio` creation (spec §3.1) → Task 1. Memory/skills/MCP nodes and the module `CLAUDE.md` are explicitly OUT of C1 (they are C2+; C1 proves the spine).

**Placeholder scan:** Tasks 1–4 contain complete code / exact mirror-source instructions. Task 5 is deliberately a spike — its "code" is an investigation with a concrete success gate and a fully-specifiable fallback (shape #1), which is the honest representation of an undocumented integration; it is not a placeholder for known code.

**Type consistency:** `ClawModelConfig` (Task 2) matches the `LlmProviderService.getDefaultConfig()` return shape consumed in `resolveClawGraph` (Task 4); `createClawGraph` consumes the `BaseChatModel` that `createClawModel` produces; the `/api/chat` route consumes `resolveClawGraph`'s compiled graph.

**Risk called out:** Task 4 live-Bedrock verification and Task 5 are environment- and library-dependent; both have explicit fallbacks and honest-reporting instructions rather than assumed success.

---

## Next plans (not in this document)

- **Plan C2:** memory (`ClawMemory` pgvector + recall/save graph nodes) + `ClawWorkingMemory`.
- **Plan C3:** skills (`ClawSkill` + load/select/inject + synthesis) and MCP (`ClawMcpServer` + `MCPServerManager` + tool binding).
- **Module `CLAUDE.md`** (spec §9) created alongside C2 once the runtime shape (incl. the Task 5 transport decision) is settled.
