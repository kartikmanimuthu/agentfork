# MCP Graph Tools — Design Spec

**Date:** 2026-05-27  
**Branch:** omar-updating-graph-agent  
**Status:** Approved for implementation

---

## Problem

The current MCP Server graph node has two fundamental issues:

1. It only supports calling **one hardcoded tool** per node. The tool name is typed manually into a text field. This is deterministic but inflexible and error-prone.
2. There is **no way for the LLM to use MCP tools dynamically** in a graph. The LLM node has no tool-calling support at all. Users who want agentic MCP behaviour must use the simple agent type instead.

This spec covers two independent changes that solve both problems.

---

## Change 1 — MCP Tools on the LLM Node (Agentic)

### Goal

Allow an LLM node in a graph to be configured with one or more MCP servers. When the node fires, it connects to those servers, discovers all their tools, and passes them to the LLM. The LLM decides which tool(s) to call based on the conversation. The AI SDK handles the entire tool-call → result → response loop internally.

### Config change

`LlmNodeConfig` in `libs/agent-studio/src/types/nodes.ts`:

```typescript
// Before
interface LlmNodeConfig {
  type: 'llm';
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];           // existed but was never implemented — remove
  contextChannels?: string[];
}

// After
interface LlmNodeConfig {
  type: 'llm';
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  mcpServerIds?: string[];    // DB IDs of MCP servers whose tools the LLM can use
  contextChannels?: string[];
}
```

The existing `tools?: string[]` field was defined in the type but never used by the executor. It is removed and replaced with `mcpServerIds`.

### Execution flow

```
LLM node fires
  ↓
if config.mcpServerIds is empty or absent → skip tool setup (identical to today)
  ↓
For each serverId in config.mcpServerIds:
  - Fetch server record from Prisma (tenantId scoped)
  - Skip if status !== 'active' (log warning, continue)
  - McpClientService.connect(server.config)
  - McpClientService.discoverTools() → [{ name, description, inputSchema }]
  - Build ToolSet entry: key = `${server.name}__${tool.name}`
    execute: (args) => mcpClient.executeTool(tool.name, args)
  ↓
provider.streamChat({
  messages,
  system,
  temperature,
  maxOutputTokens,
  tools: toolSet,       // only if tools were discovered
  maxSteps: 10,         // AI SDK handles tool-call → result → LLM loop
})
  ↓
Stream text_delta events as chunks arrive (textStream skips tool steps transparently)
  ↓ finally:
  Disconnect all MCP clients (Promise.allSettled — never throws)
```

### Key design decisions

**Graceful degradation on MCP failure:** If a server is unreachable or returns an error during `connect`/`discoverTools`, that server is skipped with a `logger.warn`. The LLM call proceeds with whatever tools were successfully discovered. If all servers fail, the LLM call proceeds with no tools (same as today).

**maxSteps = 10:** The AI SDK will allow up to 10 tool calls in a single LLM turn before forcing a final text response. Not user-configurable in v1 — hardcoded at 10. This matches best practices for production agentic loops.

**Tool namespace:** Tools are keyed as `serverName__toolName` (double underscore separator) matching the exact same convention used in `buildMcpToolsForAgent` for simple agents. Consistent across both agent types.

**Cleanup guaranteed:** All MCP clients are disconnected in a `finally` block. If `streamChat` throws, connections still close.

**No changes to graph executor:** The LLM node executor handles everything internally. The graph executor, graph state, and all other node executors are untouched.

### Files changed

| File | What changes |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Replace `tools?: string[]` with `mcpServerIds?: string[]` on `LlmNodeConfig` |
| `libs/agent-studio/src/execution/node-executors/llm-executor.ts` | MCP tool setup before streamChat; cleanup in finally |
| `apps/web-ui/components/agents/config/llm-node-form.tsx` | Add "MCP Tools" multi-select using `useMcpServers` hook |

### UI — LLM node form

Add a new "MCP Tools" section below Context Channels. Uses the same `useMcpServers({ pageSize: 100 })` hook pattern established in the MCP Server node form. Renders as a multi-select (checkboxes or a tag-style picker). Stores server DB IDs. Shows server name + status.

When no servers are configured: show helper text "Add MCP servers to let this LLM call their tools dynamically."

### Backward compatibility

- All existing LLM nodes have no `mcpServerIds` field → `undefined` → executor skips tool setup → identical behaviour to today.
- The unused `tools?: string[]` field removal is safe: no executor ever read it, no existing config would have been saving it through the form.

---

## Change 2 — Multi-Tool MCP Server Node (Deterministic Batch)

### Goal

Instead of hardcoding a single tool name in the MCP Server node, allow users to choose one of three modes:

- `single` — call one specific tool (current behaviour, fully backward compatible)
- `selected` — call a user-chosen subset of tools from the server (2 or more)
- `all` — discover and call every tool the server exposes

This is a **deterministic** change: all selected tools fire every time the node reaches execution, regardless of the user's query. The LLM is not involved in tool selection. This is intentional — it is the right model for known data-fetching pipelines (e.g. "always fetch stock price + company news + sentiment before the LLM responds").

### Config change

`McpServerNodeConfig` in `libs/agent-studio/src/types/nodes.ts`:

```typescript
// Before
interface McpServerNodeConfig {
  type: 'mcp_server';
  serverId: string;
  serverName?: string;      // added in prior session for canvas display
  toolName: string;         // required — single tool only
  argumentSource: 'from_state' | 'static';
  staticArguments?: Record<string, unknown>;
  channelMappings?: Record<string, string>;
  outputChannel: string;
}

// After
interface McpServerNodeConfig {
  type: 'mcp_server';
  serverId: string;
  serverName?: string;
  toolMode?: 'single' | 'selected' | 'all';  // default 'single' when absent
  toolName?: string;         // used in 'single' mode (optional now for new configs)
  toolNames?: string[];      // used in 'selected' mode
  argumentSource: 'from_state' | 'static';
  staticArguments?: Record<string, unknown>;
  channelMappings?: Record<string, string>;
  outputChannel: string;
}
```

`toolName` changes from required to optional. Existing configs that have it set continue to work because the executor defaults to `toolMode = 'single'` and reads `toolName`.

### Execution flow

```
MCP node fires
  ↓
Fetch server from Prisma: OR [{ id }, { name }] (backward compat lookup already in place)
Check status === 'active'
McpClientService.connect(server.config)
  ↓
const toolMode = config.toolMode ?? 'single'

if toolMode === 'single':
  args = buildArgs(config)          // existing logic unchanged
  result = executeTool(config.toolName, args)
  write: outputChannel = String(result)

if toolMode === 'selected':
  args = buildArgs(config)          // same args for all tools
  results = {}
  for each toolName in config.toolNames:
    results[toolName] = executeTool(toolName, args)
  write: outputChannel = JSON.stringify(results)

if toolMode === 'all':
  args = buildArgs(config)
  discoveredTools = discoverTools()
  results = {}
  for each tool in discoveredTools:
    results[tool.name] = executeTool(tool.name, args)
  write: outputChannel = JSON.stringify(results)
  ↓
McpClientService.disconnect()
```

### Arguments in multi-tool mode

In `selected` and `all` modes, all tools receive the same args object. The args are built the same way as today: `from_state` reads channel mappings, `static` uses the hardcoded object. Tools that need those params use them; tools that take no params receive an empty object and ignore it.

Per-tool argument mapping is explicitly out of scope for this version. It would require a complex nested UI and is rarely needed in the batch-fetch use case this mode targets.

### Output channel format

| Mode | outputChannel value |
|---|---|
| `single` | Plain string (unchanged from today) |
| `selected` / `all` | `JSON.stringify({ toolA: result, toolB: result })` |

Both are strings. The downstream LLM node's `contextChannels` logic already handles strings — no changes to the LLM executor needed. The LLM receives the JSON as readable context text.

### New API endpoint — tool discovery

The form needs to show a checklist of available tools from the selected server. A new route is required:

**`GET /api/mcp-servers/:id/tools`**

- Auth: same as other MCP routes (session tenant, `read` on `McpServers`)
- Fetches the server record from DB
- If server is not active: returns `{ tools: [], error: 'Server is inactive' }`
- If server is active: connects via `McpClientService`, calls `discoverTools()`, disconnects, returns `{ tools: [{ name, description }] }`
- On connection failure: returns `{ tools: [], error: 'Could not connect to server' }` with status 200 (not 500 — the form handles this gracefully)

**`useMcpServerTools(serverId: string)` hook** (new file in `hooks/`)

React Query hook that fetches from the above endpoint. Enabled only when `serverId` is non-empty. Returns `{ tools, isLoading, error }`.

### Form — mode selection UI

The MCP Server node form gains a "Tool Mode" selector above the tool name field:

```
Tool Mode:  [ Single ▼ ]   or   [ Selected ▼ ]   or   [ All ]

Single mode:
  Tool Name: [ dropdown of tools from server ]
  (replaces the current plain text input — populated by useMcpServerTools)

Selected mode:
  ☑ get_stock_price
  ☐ get_company_news  
  ☑ get_sentiment
  (loaded from /api/mcp-servers/:id/tools)
  Loading / error states handled gracefully

All mode:
  ⚠ All tools from this server will be called every time this node fires.
     Best for servers with few tools.
```

When tool discovery fails (server unreachable, etc.): show an error note and fall back to a plain text input so the user can still enter tool names manually.

### Files changed

| File | What changes |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Add `toolMode?`, `toolNames?`, make `toolName` optional on `McpServerNodeConfig` |
| `libs/agent-studio/src/registry/schemas/mcp-server.ts` | Match type changes in Zod schema |
| `libs/agent-studio/src/execution/node-executors/mcp-server-executor.ts` | Handle 3 modes; serialize multi-results to JSON string |
| `apps/web-ui/app/api/mcp-servers/[id]/tools/route.ts` | **NEW** — discover tools from a server |
| `apps/web-ui/hooks/use-mcp-server-tools.ts` | **NEW** — React Query hook for tool discovery |
| `apps/web-ui/components/agents/config/mcp-server-node-form.tsx` | Mode selector + conditional tool checklist |

### Backward compatibility

All existing saved MCP Server node configs have `toolName: string` and no `toolMode`. The executor reads `config.toolMode ?? 'single'` and uses `config.toolName`. Existing graphs continue to work identically with zero migration needed.

---

## What is explicitly out of scope

- Per-tool argument mapping in multi-tool mode (future enhancement)
- `maxSteps` as a user-configurable field on the LLM node (hardcoded at 10 for now)
- `all` mode tool count limit/enforcement (documented warning in UI only)
- Canvas node visual changes beyond what was already done (serverName display)
- Any changes to the simple agent type (`buildMcpToolsForAgent`) — it already works correctly

---

## Implementation order

**Do Change 2 first, then Change 1.**

Change 2 is isolated to the MCP node and a new API route — lower risk. Change 1 touches the LLM executor which is the most central piece of graph execution. Doing them in this order means if Change 1 has an issue, Change 2 is already live and useful independently.

---

## Total file count

| | Existing files | New files |
|---|---|---|
| Change 1 | 3 | 0 |
| Change 2 | 4 | 2 |
| **Total** | **7** | **2** |
