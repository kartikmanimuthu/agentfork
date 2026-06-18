# Plan: Web Search & Web Fetch Tools for Agent Studio

## Context

The codebase uses the **Vercel AI SDK** (`ai` package with `streamText` / `ToolSet`), not LangChain/LangGraph. Tools are passed to `streamChat()` via a `ToolSet` object and agentic loops are driven by `maxSteps`. The existing built-in tools (`generate_spreadsheet`, `generate_pdf`) live in `libs/ai/src/file-generation.ts` and are wired into both the production inference API and the playground.

## Goals

1. Add a configurable **web search** tool supporting three providers: **Tavily**, **Brave**, **SearXNG**
2. Add a **web fetch** tool using **Playwright** for JS-rendered page content extraction
3. Enable these tools for **simple agents** (production inference + playground)
4. Enable these tools for **graph agents** (tool node executor + LLM node executor in playground)

## Architecture

### New Files

```
libs/ai/src/tools/
  web-search.ts        # SearchToolRegistry, TavilySearchProvider, BraveSearchProvider, SearxngSearchProvider
  web-fetch.ts         # Playwright-based single-page fetch + markdown extraction
  built-in-registry.ts # Aggregates all built-in ToolSet entries (file gen + web)

libs/ai/src/tools/index.ts   # Barrel export
```

### Search Provider Design

A tenant-configurable search backend. Resolution order:
1. `TenantConfigService.get('webSearchConfig')` — per-tenant override
2. Environment variables (`TAVILY_API_KEY`, `BRAVE_API_KEY`, `SEARXNG_API_BASE`) — global fallback

The config shape:
```typescript
interface WebSearchConfig {
  provider: 'tavily' | 'brave' | 'searxng';
  // Provider-specific
  apiKey?: string;        // Tavily / Brave
  apiBase?: string;       // SearXNG
  maxResults?: number;    // default 5
}
```

All providers return a normalized `SearchResult[]`:
```typescript
interface SearchResult {
  title: string;
  url: string;
  content: string;  // cleaned snippet or full extracted text
  score?: number;
}
```

### Web Fetch Design

Uses the existing `playwright` dependency (already in root `package.json`). Launches a headless Chromium instance, navigates to the URL, waits for `networkidle` (with timeout), extracts page text via `document.body.innerText`, and returns a cleaned string capped at 8,000 chars to fit in context windows.

Why Playwright directly instead of Crawlee:
- Crawlee is designed for multi-page crawls with queues; we only need single-page fetches.
- Direct Playwright is lighter, faster, and avoids Crawlee's on-disk storage overhead.

### Built-in Tool Registry

`built-in-registry.ts` exports a `ToolSet` compatible with the Vercel AI SDK:
```typescript
export function buildBuiltInTools(tenantId: string, db: any): ToolSet {
  // Returns { web_search: { description, parameters: jsonSchema(...), execute }, web_fetch: {...} }
}
```

## UI Changes

### Simple Agent Form (`apps/web-ui/components/agents/config/simple-agent-form.tsx`)
- Add a "Built-in Tools" section with toggle switches for `web_search` and `web_fetch`.
- The `SimpleAgentConfig.tools` array currently only holds MCP tool names; extend it to also accept built-in tool names (`web_search`, `web_fetch`).

### Graph Agent — Tool Node Form (`apps/web-ui/components/agents/config/tool-node-form.tsx`)
- Replace free-text `toolName` input with a searchable dropdown that includes:
  - Built-in tools (`web_search`, `web_fetch`)
  - MCP tools (discovered from attached servers)
- When a built-in tool is selected, show its parameter schema as optional overrides.

### Graph Agent — LLM Node Form (`apps/web-ui/components/agents/config/llm-node-form.tsx`)
- Add a "Tools" multi-select field to the `LlmNodeConfig`, allowing the user to wire `web_search` / `web_fetch` into the LLM node for agentic tool-calling loops.

## Backend Changes

### 1. `libs/ai/src/tools/web-search.ts`
- Abstract `SearchProvider` interface
- `TavilySearchProvider`: `fetch('https://api.tavily.com/search', ...)`
- `BraveSearchProvider`: `fetch('https://api.search.brave.com/res/v1/web/search', ...)`
- `SearxngSearchProvider`: `fetch('${apiBase}/search?format=json&q=...', ...)`
- `WebSearchTool`: Vercel AI SDK `ToolSet` entry wrapping the provider

### 2. `libs/ai/src/tools/web-fetch.ts`
- `WebFetchTool`: Vercel AI SDK `ToolSet` entry
- Uses `playwright` to launch, navigate, extract text
- Includes `playwright.close()` cleanup in a `finally` block

### 3. `libs/ai/src/tools/built-in-registry.ts`
- Factory function `buildBuiltInTools(tenantId, db)` that:
  1. Reads `TenantConfigService` for `webSearchConfig`
  2. Instantiates the correct search provider
  3. Returns a `ToolSet` with `web_search` and `web_fetch`

### 4. `libs/ai/src/index.ts`
- Export `{ buildBuiltInTools, type WebSearchConfig }` from `./tools`

### 5. Simple Agent — Playground (`apps/web-ui/app/api/agents/[id]/playground/route.ts`)
- After `buildMcpToolsForAgent`, also call `buildBuiltInTools(tenantId, db)`
- Merge into `allTools = { ...mcpTools, ...builtInTools }`
- Pass to `streamChat({ tools: allTools, maxSteps: 5 })`

### 6. Simple Agent — Production Inference (`apps/web-ui/app/api/v1/inference/route.ts`)
- Same merge pattern as playground (~line 674 where `fileGenTools` are merged)
- Add `builtInTools` alongside `fileGenTools` and `mcpTools`

### 7. Graph Agent — Tool Node Executor (`libs/agent-studio/src/execution/node-executors/tool-executor.ts`)
- Currently unimplemented (logs warning, returns empty)
- Implement by resolving `toolName` against:
  1. Built-in tools (via `buildBuiltInTools`)
  2. MCP tools (via `buildMcpToolsForAgent` or from context)
- Execute the tool with `config.parameters`, write result to `state.channels[config.toolName + '_result']`

### 8. Graph Agent — LLM Node Executor (`libs/agent-studio/src/execution/node-executors/llm-executor.ts`)
- Accept `tools` array from `LlmNodeConfig`
- If tools are configured, resolve them into a `ToolSet` and pass to `provider.streamChat({ tools, maxSteps: 5 })`
- Requires the `ExecutionServices` interface to expose a `buildTools` helper or the executor to import `buildBuiltInTools` directly.

### 9. Node Registry Schema Updates
- `libs/agent-studio/src/registry/schemas/tool.ts`: Add optional `parameters` schema validation
- `libs/agent-studio/src/registry/schemas/llm.ts`: Add optional `tools` array of strings
- `libs/agent-studio/src/types/nodes.ts`: Update `ToolNodeConfig` and `LlmNodeConfig` interfaces accordingly

### 10. Env Variables
Add to `.env.example`:
```bash
# Web Search (pick one provider)
TAVILY_API_KEY=tvly-...
BRAVE_API_KEY=BS...
SEARXNG_API_BASE=http://localhost:8888
```

## Testing Strategy

1. **Unit tests** in `libs/ai/src/tools/`:
   - Mock `fetch` for Tavily/Brave/SearXNG search providers
   - Mock `playwright` for web fetch
2. **Integration** via Playground:
   - Create a simple agent, enable `web_search`, ask a question requiring current info
3. **Graph**:
   - Add a `tool` node with `web_search`, wire it to an LLM node, verify state updates

## Rollout Order

| Step | Files | Notes |
|------|-------|-------|
| 1 | `libs/ai/src/tools/*` | Core tool implementations |
| 2 | `libs/ai/src/index.ts` | Export new modules |
| 3 | `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Wire into simple agent playground |
| 4 | `apps/web-ui/app/api/v1/inference/route.ts` | Wire into production simple agent |
| 5 | `libs/agent-studio/src/execution/node-executors/tool-executor.ts` | Implement graph tool node |
| 6 | `libs/agent-studio/src/execution/node-executors/llm-executor.ts` | Add tool support to graph LLM node |
| 7 | `libs/agent-studio/src/types/nodes.ts` + schemas | Update config types |
| 8 | UI forms (simple-agent-form, tool-node-form, llm-node-form) | Enable tool selection |
| 9 | `.env.example` | Document new env vars |
| 10 | Tests | Add coverage |

## Open Questions / Decisions

1. **Graph LLM executor tool resolution**: Should the `GraphExecutor` pre-build a tool registry at execution start and pass it through `ExecutionServices`? Or should each node executor import `buildBuiltInTools` independently? → **Decision**: Pass a `toolRegistry` through `ExecutionServices` so tools are built once per execution, not per-node.

2. **Playwright singleton vs. per-call launch**: Launching Chromium per fetch is expensive. Should we keep a reusable browser instance? → **Decision**: Launch per-call for simplicity and isolation. Optimize later if latency is unacceptable.

3. **Tenant config vs. global env for search provider**: Should a tenant be able to override the global provider? → **Decision**: Yes, `TenantConfigService` with key `webSearchConfig` takes precedence; env vars are the global fallback.
