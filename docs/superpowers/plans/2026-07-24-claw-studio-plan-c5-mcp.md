# Claw Studio — Plan C5: MCP (bridge to chatflow's existing MCP infrastructure)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claw real MCP (Model Context Protocol) tool access — every `active` MCP server a tenant has registered becomes a callable LangChain tool in Claw's executor graph — plus a real **MCP Configuration** management page in Mission Control replacing its "coming soon" stub.

**Architecture — this plan is a bridge, not a nucleus port.** Research turned up something important: **chatflow already has its own native, fully-built MCP server subsystem**, created for Agent Studio (the workflow builder in `apps/web-ui`) — `McpServer`/`McpServerVersion`/`AgentMcpServer` Prisma models, `McpServerService` (CRUD) and `McpClientService` (live connect/discover/execute) in `libs/agent-studio`, plus a complete settings UI, API routes, and TanStack Query hooks in `apps/web-ui`. Porting nucleus's separate `TenantConfigService`-JSON-blob MCP subsystem (as originally planned before this research) would create a second, parallel, duplicate MCP implementation in the same monorepo — exactly the kind of duplication the "don't add abstractions beyond what's needed" rule exists to prevent. Instead, this plan **reuses the existing `McpServer` registry as-is** and adds only the genuinely new piece: a LangChain tool-bridge for Claw's executor graph (Agent Studio's own bridge, `buildMcpToolsForAgent`, targets the Vercel AI SDK's `ToolSet` format, which is incompatible with the LangChain `tool()` instances Claw's graph consumes), plus a Mission-Control-side settings surface for it (mission-control is a separate app/session from web-ui, so it needs its own thin CRUD UI — same shape as Plan C4's Skills page — even though the underlying data and connection logic are 100% shared).

**Key design decision:** `McpServer` rows are **tenant-wide**, not per-agent. Agent Studio opts individual workflow agents in via the `AgentMcpServer` join table; Claw does **not** get a parallel join table — it simply uses **every `status: 'active'` `McpServer` row for its tenant**, mirroring the tenant-wide (not per-Claw) scoping Plan C4 already established for `ClawSkill`. One registry, two consumers, no duplicate credential entry.

**Known, accepted limitation (not introduced by this plan):** `McpClientService.createTransport` (in `libs/agent-studio/src/services/mcp-client.service.ts`) only actually connects `sse` and `http_bridge` transports at runtime — `stdio` is a valid stored config shape (and offered in the existing web-ui form) but throws `Unsupported MCP transport` when connected. This is a pre-existing gap in the shared service, inherited as-is; Claw's MCP tools will only materialize for `sse`/`http_bridge` servers until/unless that shared client is extended (out of scope here — it's shared infra used by Agent Studio too, not Claw-specific).

**Tech Stack additions:** None. `@modelcontextprotocol/sdk` is already a root dependency; `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers` are already in `apps/mission-control/package.json` from Plan C4. The only wiring needed is adding `@chatbot/agent-studio` as a resolvable import for `apps/mission-control` (tsconfig paths + `transpilePackages`), the same way `@chatbot/claw-studio` already is.

## Global Constraints

- **Read the CURRENT source** before writing any adapted file: `libs/agent-studio/src/types/mcp-server.ts`, `libs/agent-studio/src/services/mcp-server-service.ts`, `libs/agent-studio/src/services/mcp-client.service.ts`, `libs/shared/src/validation/schemas/agents.ts` (the `createMcpServerSchema`/`updateMcpServerSchema` section), `apps/web-ui/app/api/mcp-servers/{route,[id]/route,[id]/test/route}.ts`, `apps/web-ui/hooks/use-mcp-servers.ts`, `apps/web-ui/components/mcp-servers/mcp-server-form.tsx` — this plan's code is a faithful, well-researched starting point, not a substitute.
- **No new Prisma model, no new migration.** Storage is the existing `McpServer` table (`@@map("mcp_servers")`), already tenant-scoped.
- **Bridges (the only intended changes):** Studio-session auth (`getServerSession(authOptions)` + `session.studio.tenantId`) instead of web-ui's RBAC `authorize()` calls — matches Plan C4's established bridge; react-hook-form + `@hookform/resolvers/zod` instead of web-ui's `@tanstack/react-form` for the settings form — matches the form library Plan C4 already installed in mission-control (no second form library); a **real** "test connection" (calls `McpClientService.discoverTools`) instead of web-ui's `[id]/test/route.ts`, which only checks `server.status === 'active'` and never actually connects — a gap this port corrects, not copies, per the same principle Plan C4 applied to skills' Zod validation.
- **No version history UI in v1** — `McpServerVersionService` exists and auto-snapshots are wired on create/update (cheap, already-built, and web-ui's own routes do it — keeping it costs nothing), but Claw's settings page does not expose a version list/restore UI, matching Skills' own no-version-history scope in Plan C4. Revisit only if asked.
- **No per-Claw attachment join table** — every `active` `McpServer` for the tenant is available to Claw automatically (see Architecture above). No new join table, no manual per-conversation server picker (nucleus's Agent Ops has none either — the reference this executor graph is cloned from just uses every enabled server).
- **MCP tool creation is async and per-run**, not a persistent connection-pool singleton (unlike nucleus's `MCPServerManager`) — it follows `buildMcpToolsForAgent`'s existing pattern exactly: connect fresh `McpClientService` instances when a run starts, return a `cleanup()` alongside the tools, call it when the run ends (success, error, or cancel).
- **Standards:** typed params (no implicit `any`); try/catch + Pino (`createLogger`) in every route/service/graph-node touch point; Zod at both new API route boundaries (reusing `createMcpServerSchema`/`updateMcpServerSchema` from `@chatbot/shared` — do not write new ones); shadcn/ui components only in the UI; fail-open behavior — a broken/unreachable MCP server must never crash a run, only produce zero tools for that server (matches `buildMcpToolsForAgent`'s existing per-server try/catch).

---

### Task 1: Wire `@chatbot/agent-studio` into `apps/mission-control`

**Files:**
- Modify: `apps/mission-control/next.config.ts`
- Modify: `apps/mission-control/tsconfig.json`

**Interfaces:** Makes `@chatbot/agent-studio` (client-safe barrel: types, `McpServerService`, `McpServerVersionService`) and `@chatbot/agent-studio/server` (server-only: `McpClientService`, `buildMcpToolsForAgent`, graph executors) resolvable from both `apps/mission-control` and `libs/claw-studio`.

- [ ] **Step 1:** In `apps/mission-control/next.config.ts`, add `@chatbot/agent-studio` to `transpilePackages`:

```ts
transpilePackages: ['@chatbot/shared', '@chatbot/claw-studio', '@chatbot/agent-studio', '@t3-oss/env-nextjs', '@t3-oss/env-core'],
```

- [ ] **Step 2:** In `apps/mission-control/tsconfig.json`'s `compilerOptions.paths`, add:

```json
"@chatbot/agent-studio": ["../../libs/agent-studio/src/index.ts"],
"@chatbot/agent-studio/server": ["../../libs/agent-studio/src/server.ts"]
```

(`tsconfig.base.json` already has both — confirmed present; only the app-level tsconfig needs the entries, matching how `@chatbot/claw-studio` was added in Plan C4.)

- [ ] **Step 3: Verify** `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` still passes (no consumers yet, so this just confirms the path resolves without error — add a throwaway `import type { McpServer } from '@chatbot/agent-studio';` in a scratch file, confirm no error, then delete the scratch file).

---

### Task 2: Claw's MCP → LangChain tool bridge — `libs/claw-studio/src/mcp/mcp-tools.ts`

**Files:**
- Create: `libs/claw-studio/src/mcp/mcp-tools.ts`
- Test: `libs/claw-studio/src/mcp/mcp-tools.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:** `createMcpTools(tenantId: string): Promise<{ tools: StructuredTool[]; cleanup: () => Promise<void> }>` — loads every `active` `McpServer` for `tenantId` via `McpServerService`, connects each via `McpClientService.discoverTools`, and wraps each discovered tool as a LangChain `tool()`. Never throws — a server that fails to connect is skipped (logged), matching `buildMcpToolsForAgent`'s per-server try/catch.

- [ ] **Step 1:** Read `libs/agent-studio/src/services/mcp-client.service.ts` in full (already captured verbatim during research) — note `McpClientService` is a **per-instance, single-connection** class (`connect`/`discoverTools`/`executeTool`/`disconnect`), not a manager; one instance per server, matching `buildMcpToolsForAgent`'s usage.

- [ ] **Step 2:** Read `libs/agent-studio/src/services/mcp-server-service.ts`'s `findMany` signature — `findMany(filters): Promise<{ items: McpServer[]; total: number; page: number; pageSize: number }>`.

- [ ] **Step 3: Write the failing test.** Mock `@chatbot/agent-studio` and `@chatbot/agent-studio/server` (following the established `vi.mock` pattern from `skill-tool.test.ts`/`memory-tools.test.ts` — real-DB integration style is not viable here since we must not spawn a real MCP connection in unit tests):

```ts
import { describe, it, expect, vi } from 'vitest';

const mockFindMany = vi.fn();
vi.mock('@chatbot/agent-studio', () => ({
  McpServerService: vi.fn().mockImplementation(() => ({ findMany: mockFindMany })),
}));

const mockDiscoverTools = vi.fn();
const mockExecuteTool = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('@chatbot/agent-studio/server', () => ({
  McpClientService: vi.fn().mockImplementation(() => ({
    discoverTools: mockDiscoverTools,
    executeTool: mockExecuteTool,
    disconnect: mockDisconnect,
  })),
}));

vi.mock('@chatbot/shared', () => ({ getPrismaClient: vi.fn(() => ({})), createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }));

import { createMcpTools } from './mcp-tools';

describe('createMcpTools', () => {
  it('returns an empty tool list when the tenant has no active servers', async () => {
    mockFindMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    const { tools, cleanup } = await createMcpTools('tenant-1');
    expect(tools).toEqual([]);
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('namespaces tools as mcp_<serverName>_<toolName> and executes via the discovered client', async () => {
    mockFindMany.mockResolvedValue({
      items: [{ id: 's1', name: 'Grafana', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://x' } } }],
      total: 1, page: 1, pageSize: 100,
    });
    mockDiscoverTools.mockResolvedValue([{ name: 'query_metrics', description: 'Query metrics', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }]);
    mockExecuteTool.mockResolvedValue('42');

    const { tools, cleanup } = await createMcpTools('tenant-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_grafana_query_metrics');

    const result = await tools[0].invoke({ q: 'cpu' } as any);
    expect(result).toBe('42');
    expect(mockExecuteTool).toHaveBeenCalledWith('query_metrics', { q: 'cpu' });

    await cleanup();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('skips a server that fails to connect and still returns tools from the others', async () => {
    mockFindMany.mockResolvedValue({
      items: [
        { id: 's1', name: 'Broken', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://bad' } } },
        { id: 's2', name: 'Good', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://good' } } },
      ],
      total: 2, page: 1, pageSize: 100,
    });
    mockDiscoverTools.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce([{ name: 'ping', description: '', inputSchema: {} }]);
    const { tools } = await createMcpTools('tenant-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_good_ping');
  });
});
```

- [ ] **Step 4: Implement.** A JSON-Schema→Zod converter is needed for each discovered tool's `inputSchema` — port the same logic nucleus's `mcp-tools.ts` uses (`jsonSchemaPropertyToZod`/`jsonSchemaToZodObject`, captured verbatim in research) rather than reinventing it; it is transport-agnostic and has no nucleus-specific dependencies.

```ts
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { McpServerService } from '@chatbot/agent-studio';
import { McpClientService } from '@chatbot/agent-studio/server';
import type { McpServer, McpServerConfig } from '@chatbot/agent-studio';
import { getPrismaClient, createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:mcp-tools');

function jsonSchemaPropertyToZod(prop: any, required: boolean): z.ZodTypeAny {
  let zodType: z.ZodTypeAny;
  switch (prop?.type) {
    case 'string': zodType = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string(); break;
    case 'number':
    case 'integer': zodType = z.number(); break;
    case 'boolean': zodType = z.boolean(); break;
    case 'array': zodType = prop.items ? z.array(jsonSchemaPropertyToZod(prop.items, true)) : z.array(z.any()); break;
    case 'object': zodType = prop.properties ? jsonSchemaToZodObject(prop) : z.record(z.string(), z.any()); break;
    default: zodType = z.any();
  }
  if (prop?.description) zodType = zodType.describe(prop.description);
  return required ? zodType : zodType.optional();
}

function jsonSchemaToZodObject(schema: any): z.ZodObject<any> {
  if (!schema?.properties) return z.object({});
  const required: string[] = schema.required || [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties) as [string, any][]) {
    shape[key] = jsonSchemaPropertyToZod(prop, required.includes(key));
  }
  return z.object(shape);
}

function slugForName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function createMcpTools(tenantId: string): Promise<{ tools: StructuredTool[]; cleanup: () => Promise<void> }> {
  const db = getPrismaClient();
  const service = new McpServerService(tenantId, db as any);

  let servers: McpServer[] = [];
  try {
    const result = await service.findMany({ status: 'active' });
    servers = result.items;
  } catch (error) {
    logger.error({ error, tenantId }, 'Failed to list MCP servers — returning no MCP tools');
    return { tools: [], cleanup: async () => {} };
  }

  const clients: McpClientService[] = [];
  const tools: StructuredTool[] = [];

  for (const server of servers) {
    const client = new McpClientService();
    try {
      const config = server.config as McpServerConfig;
      const discovered = await client.discoverTools(config);
      clients.push(client);

      for (const t of discovered) {
        const namespacedName = `mcp_${slugForName(server.name)}_${t.name}`.slice(0, 64);
        let zodSchema: z.ZodObject<any>;
        try {
          zodSchema = jsonSchemaToZodObject(t.inputSchema || {});
        } catch {
          zodSchema = z.object({}).passthrough();
        }

        tools.push(
          tool(
            async (input: Record<string, unknown>) => {
              try {
                const result = await client.executeTool(t.name, input);
                return typeof result === 'string' ? result : JSON.stringify(result);
              } catch (error: any) {
                logger.error({ error, server: server.name, tool: t.name }, '[mcp] tool execution failed');
                return `Error executing MCP tool "${t.name}": ${error.message}`;
              }
            },
            { name: namespacedName, description: `[MCP: ${server.name}] ${t.description || t.name}`, schema: zodSchema },
          ),
        );
      }
      logger.info({ tenantId, server: server.name, toolCount: discovered.length }, '[mcp] connected and discovered tools');
    } catch (error: any) {
      logger.warn({ error: error?.message, tenantId, server: server.name }, '[mcp] failed to connect — skipping this server');
    }
  }

  const cleanup = async () => {
    await Promise.allSettled(clients.map((c) => c.disconnect()));
  };

  return { tools, cleanup };
}
```

- [ ] **Step 5:** Add to `libs/claw-studio/src/index.ts`:

```ts
export { createMcpTools } from './mcp/mcp-tools';
```

- [ ] **Step 6: Run** `bunx vitest run src/mcp/mcp-tools.test.ts` in `libs/claw-studio` → all pass.

---

### Task 3: Wire MCP tools + cleanup into the runtime

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts`
- Modify: `apps/mission-control/app/api/chat/route.ts`

**Interfaces:** `ClawRuntime` gains `mcpCleanup: () => Promise<void>`. `createClawGraph`/`claw-graph.ts` need **no changes** — `resolveClawRuntime` already builds the full explicit `tools` array and passes it via `deps.tools`, bypassing `createClawGraph`'s (synchronous, test-only) default-tools fallback.

- [ ] **Step 1:** In `claw-runtime.ts`, extend the tools construction (currently `const tools = [...createMemoryTools(tenantId, claw.id), createLoadSkillTool(tenantId)];`) to:

```ts
import { createMcpTools } from '../mcp/mcp-tools';
// ...
const { tools: mcpTools, cleanup: mcpCleanup } = await createMcpTools(tenantId);
const tools = [...createMemoryTools(tenantId, claw.id), createLoadSkillTool(tenantId), ...mcpTools];
```

Add `mcpCleanup` to the returned `ClawRuntime` object and to the `ClawRuntime` interface (`mcpCleanup: () => Promise<void>`).

- [ ] **Step 2:** In `apps/mission-control/app/api/chat/route.ts`'s `finally` block (currently `if (threadId) cleanupRun(threadId);`), add:

```ts
} finally {
  if (threadId) cleanupRun(threadId);
  await runtime.mcpCleanup?.().catch(() => {});
}
```

Also add the same `await runtime.mcpCleanup?.().catch(() => {})` immediately after the cancel-path `resolveClawRuntime` call (the `DELETE`/cancel handler around line 117), since a cancelled run's freshly-connected MCP clients must not be left open either.

- [ ] **Step 3: Update** `claw-runtime.test.ts` — mock `createMcpTools` to resolve `{ tools: [], cleanup: async () => {} }` (matching how the existing tests already stub `createMemoryTools`/`createLoadSkillTool`), add one test asserting `mcpCleanup` is present on the returned runtime and is a function.

- [ ] **Step 4: Run** `bunx vitest run src/agent/claw-runtime.test.ts` in `libs/claw-studio` → all pass.

---

### Task 4: Mission Control API routes — `/api/mcp-servers`

**Files:**
- Create: `apps/mission-control/app/api/mcp-servers/route.ts` (GET list, POST create)
- Create: `apps/mission-control/app/api/mcp-servers/[id]/route.ts` (GET one, PATCH update, DELETE)
- Create: `apps/mission-control/app/api/mcp-servers/[id]/test/route.ts` (POST — real connection test)

**Interfaces:** Reuses `createMcpServerSchema`/`updateMcpServerSchema` (`@chatbot/shared`) and `McpServerService`/`McpServerVersionService` (`@chatbot/agent-studio`) verbatim — the only new code is the Studio-session auth bridge (replacing web-ui's `authorize()`/`getSessionTenantId(authOptions)`) and, in the test route, a genuine connection probe.

- [ ] **Step 1:** `apps/mission-control/app/api/mcp-servers/route.ts` — bridge of `apps/web-ui/app/api/mcp-servers/route.ts`, with `getServerSession(authOptions)` + `session.studio.tenantId` replacing `getSessionTenantId(authOptions)`/`authorize()`, matching `apps/mission-control/app/api/skills/route.ts`'s existing auth pattern exactly. Keep the version-snapshot-on-create call (`McpServerVersionService.create(...)`, cheap and already built) even though v1 doesn't expose a version UI.

- [ ] **Step 2:** `apps/mission-control/app/api/mcp-servers/[id]/route.ts` — same bridge for GET/PATCH/DELETE (nucleus's/web-ui's route uses PUT for update; Plan C4's skills route used PATCH — use **PATCH** here too, for consistency with Claw's own established convention over web-ui's).

- [ ] **Step 3:** `apps/mission-control/app/api/mcp-servers/[id]/test/route.ts` — **do not copy web-ui's shallow `status === 'active'` check.** Instead:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { McpServerService } from '@chatbot/agent-studio';
import { McpClientService } from '@chatbot/agent-studio/server';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:mcp-servers:test');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;
    const service = new McpServerService(session.studio.tenantId, getPrismaClient() as any);
    const server = await service.findById(id);
    if (!server) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const client = new McpClientService();
    try {
      const tools = await client.discoverTools(server.config as any);
      return NextResponse.json({ success: true, connected: true, toolCount: tools.length, tools: tools.map((t) => t.name) });
    } catch (error: any) {
      return NextResponse.json({ success: true, connected: false, error: error.message });
    } finally {
      await client.disconnect().catch(() => {});
    }
  } catch (error) {
    logger.error({ error }, 'MCP server test failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify** `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` passes.

---

### Task 5: Client hooks — `apps/mission-control/hooks/use-mcp-servers.ts`

**Files:**
- Create: `apps/mission-control/hooks/use-mcp-servers.ts`

**Interfaces:** `useMcpServers(filters)`, `useMcpServer(id)`, `useCreateMcpServer()`, `useUpdateMcpServer(id)`, `useDeleteMcpServer()`, `useTestMcpServer(id)` — port of `apps/web-ui/hooks/use-mcp-servers.ts`, dropping the agent-attachment hooks (`useAgentMcpServers`/`useAttachMcpServer`/`useDetachMcpServer`) and version-history hooks (`useMcpServerVersions`/`useRestoreMcpServerVersion`) — out of scope per Global Constraints.

- [ ] **Step 1:** Copy the six kept functions/hooks + the `mcpServerKeys` factory from `apps/web-ui/hooks/use-mcp-servers.ts` verbatim (fetch URLs are identical — same `/api/mcp-servers` shape), dropping the agent/version pieces.

- [ ] **Step 2: Verify** `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` passes.

---

### Task 6: MCP settings UI

**Files:**
- Create: `apps/mission-control/components/mcp/mcp-server-form-dialog.tsx`
- Create: `apps/mission-control/components/mcp/mcp-servers-client.tsx`
- Modify: `apps/mission-control/app/(console)/mcp/page.tsx` (replace stub)
- Modify: `apps/mission-control/lib/nav-config.ts` (`MCP Configuration` → `enabled: true`)

**Interfaces:** A data-table + create/edit-dialog UX — matching Skills' UI shape exactly (`skills-client.tsx`/`skill-form-dialog.tsx`) — rather than web-ui's form/JSON-toggle Monaco editor, since `McpServerConfig` is a well-typed discriminated union (perfect fit for a plain react-hook-form + Zod dialog, no freeform JSON needed).

- [ ] **Step 1:** `mcp-server-form-dialog.tsx` — react-hook-form + `zodResolver`, reusing the `transportSchema`/`schema` shape from `apps/web-ui/components/mcp-servers/mcp-server-form.tsx` (the discriminated union over `sse`/`stdio`/`http_bridge`), rebuilt with react-hook-form idioms (`Controller` for the transport `Select`, matching `skill-form-dialog.tsx`'s `Select`-in-`FormField` pattern) instead of `@tanstack/react-form`. Keep the same three transport field-sets and the bearer-token shortcut input (derives/writes `headers.Authorization` under the hood) — do not build a generic key-value editor; mirror the existing simpler UX exactly.

- [ ] **Step 2:** `mcp-servers-client.tsx` — `DataTable` with columns Name, Transport (badge), Status (badge — `active`/`inactive`/`error`), Created, Actions (View/Edit/Test connection/Delete via `DropdownMenu`, matching `skills-client.tsx`'s action-menu pattern exactly, including the `render={...}` prop form for `DropdownMenuTrigger` — this codebase's `dropdown-menu.tsx` uses `@base-ui/react`, not Radix `asChild`).

- [ ] **Step 3:** Replace `apps/mission-control/app/(console)/mcp/page.tsx`'s stub with `<McpServersClient />`, matching `skills/page.tsx`'s shape.

- [ ] **Step 4:** Flip `{ name: 'MCP Configuration', href: '/mcp', icon: Server, enabled: false }` → `enabled: true` in `lib/nav-config.ts`.

- [ ] **Step 5: Verify** `bunx tsc --noEmit -p tsconfig.json` and `bunx nx build mission-control` both pass.

---

### Task 7: Full verification

- [ ] Run `bunx vitest run` in `libs/claw-studio` → all tests (including the new `mcp-tools.test.ts` and the updated `claw-runtime.test.ts`) pass.
- [ ] `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` and `bunx nx build mission-control` both clean.
- [ ] Live browser check: open `/mcp`, create an SSE-transport server (any URL — a real MCP endpoint isn't required to verify the plumbing), confirm it appears in the table, click **Test connection** and confirm a graceful `connected: false` failure message renders (not a crash) for an unreachable URL, edit it, delete it.
- [ ] Confirm `/api/chat` still streams a reply with zero configured MCP servers (fail-open — `createMcpTools` returning `{ tools: [], cleanup }` must not break the graph).

---

**Standing reminder:** per the user's explicit instruction, do not commit any of this work unless told to — keep everything staged/uncommitted, same as Plan C4.
