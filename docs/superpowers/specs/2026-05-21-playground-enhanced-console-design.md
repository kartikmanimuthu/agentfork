# Enhanced Playground: Developer Console & Markdown Rendering

## Overview

Enhance the playground module with proper markdown rendering, per-message observability metadata, and a developer console for debugging agent behavior. The console serves both internal developers (raw protocol debugging) and tenant operators (structured metrics and error monitoring).

## Layout Architecture

Three-column layout with an enhanced right panel:

```
┌─────────┬──────────────────────────┬────────────────────────┐
│Sessions │       Chat Area          │   Console (tabbed)     │
│ sidebar │                          │   ┌─────────────────┐  │
│ (256px) │  [markdown-rendered      │   │Events│Raw│Trace│  │
│         │   messages with          │   │Metrics│          │
│         │   click-to-inspect]      │   │                  │  │
│         │                          │   │ structured logs  │  │
│         │                          │   │ per-message      │  │
│         │                          │   └─────────────────┘  │
│         │                          │   ═══ drag handle ═══   │
│         │                          │   ┌─────────────────┐  │
│         │                          │   │ Config Overrides │  │
│         │                          │   │ (collapsible)    │  │
│         │                          │   └─────────────────┘  │
│         │  ┌────────────────────┐  │                        │
│         │  │ Chat input         │  │                        │
└─────────┴──┴────────────────────┴──┴────────────────────────┘
```

### Panel Dimensions

- Sessions sidebar: 256px fixed
- Chat area: flex-1
- Right panel: 380px default, resizable via vertical drag handle between chat and panel
- Console/Config vertical split: 65/35 default ratio, adjustable via horizontal drag handle
- Right panel collapses entirely on screens < 1024px (toggle button in header)
- Panel sizes persisted to localStorage

### Message-to-Console Linking

- Clicking an assistant message selects it (left-border accent highlight)
- Console filters to show only that message's events/metrics
- Console auto-scrolls to the relevant section
- Clicking outside any message (or a "Show All" button) resets to session-wide view

## Console Tabs

### Tab 1: Events (default)

Structured event log showing each step of agent execution.

| Column | Description |
|--------|-------------|
| Timestamp | Relative ms from request start (e.g., `+1,204ms`) |
| Severity | INFO (green), WARN (yellow), ERROR (red) |
| Event | Event type name (e.g., `tool_call`, `text_delta_end`) |
| Detail | Contextual info (model name, token count, tool args) |

Behavior:
- Events grouped per-message with collapsible headers
- Filterable by severity and event type (dropdown filters)
- Auto-scrolls during streaming; pauses when user manually scrolls
- Resume auto-scroll button appears when paused
- Color-coded severity with monospace font

### Tab 2: Raw

Sub-tabs within Raw:
- **Request**: HTTP method, URL, headers, formatted JSON body
- **Response**: Status code, headers, timing breakdown (TTFB)
- **SSE Stream**: Raw event stream as received (`event: ...\ndata: {...}`)

All sub-tabs have:
- Syntax-highlighted JSON (using existing Prism setup from ChatBubble)
- Copy-to-clipboard button
- Word-wrap toggle

### Tab 3: Trace

For graph agents:
- Visual execution path through graph nodes
- Each node shows: name, type, duration, status (success/error)
- Collapsible tree view with indentation for nested execution
- Node-level input/output viewable on expand

For simple agents:
- Tool call chain (if MCP tools are used)
- Each tool shows: name, args (truncated), result (truncated), duration
- Expandable to see full args/result

### Tab 4: Metrics

**Per-message view** (when a message is selected):

| Metric | Display |
|--------|---------|
| Input tokens | Number with bar visualization |
| Output tokens | Number with bar visualization |
| Thinking tokens | Number with bar visualization (if applicable) |
| Total tokens | Sum |
| Time to first token (TTFT) | Duration in ms |
| Total generation time | Duration in ms/s |
| Model used | Model ID string |
| Cost estimate | USD amount (input + output + thinking breakdown) |

**Per-session view** (default, no message selected):

| Metric | Display |
|--------|---------|
| Total tokens | Stacked bar chart (input vs output vs thinking) |
| Latency trend | Sparkline across messages |
| Total cost | Sum of all message costs |
| Message count | Number |
| Avg tokens/message | Computed average |
| Avg latency | Computed average |

## Chat Area Enhancements

### Markdown Rendering

Both playground pages already use the shared `ChatMessages` → `ChatBubble` component which has ReactMarkdown support for assistant messages. The rendering bug visible in the current UI (raw `<br>` tags, unrendered tables) is caused by the API response containing literal HTML entities instead of newlines. The fix is to sanitize/normalize the assistant content before passing it to ReactMarkdown:
- Strip or convert `<br>` tags to `\n` before markdown parsing
- Ensure the AI SDK stream content is passed as raw text (not HTML-escaped)

Supported markdown features (already implemented in ChatBubble):
- Tables with styled headers
- Code blocks with syntax highlighting (Prism) and copy button
- Inline code with background styling
- Headings (h1-h3)
- Ordered and unordered lists
- Blockquotes
- Horizontal rules

### Message Metadata Bar

Each assistant message gets a subtle footer bar below the content:

```
┌─────────────────────────────────────────┐
│ [rendered markdown content]             │
├─────────────────────────────────────────┤
│ ⚡ 3.2s  •  487 tokens  •  claude-3.5  │
└─────────────────────────────────────────┘
```

- Shows: total latency, total tokens, model name
- Subtle styling (muted text, smaller font, border-top separator)
- Entire message area is clickable to select for console inspection
- Selected state: left-border accent color (primary)

### Thinking Display

When the model uses extended thinking:
- Collapsible block above the response text: "Thought for X.Xs" with a chevron
- Collapsed by default; expanding shows the thinking content
- Thinking content rendered as plain text (not markdown)
- Full thinking detail available in Console Events tab

### Streaming State

During active streaming:
- Pulsing dot indicator next to the message
- Elapsed time counter updating in real-time
- Metadata bar shows partial metrics (tokens so far, elapsed time)
- Console Events tab streams events in real-time

## Backend: Enhanced SSE Protocol

### Event Types

The playground API route emits these structured events during streaming:

```
event: execution_start
data: {"executionId":"...","model":"...","temperature":0.7,"maxTokens":4096,"timestamp":...}

event: thinking_start
data: {"timestamp":...}

event: thinking_delta
data: {"delta":"..."}

event: thinking_end
data: {"tokens":342,"durationMs":1192}

event: tool_call
data: {"id":"...","toolName":"...","args":{...},"timestamp":...}

event: tool_result
data: {"id":"...","toolName":"...","result":{...},"durationMs":895}

event: text_delta
data: {"delta":"..."}

event: error
data: {"code":"...","message":"...","timestamp":...}

event: execution_end
data: {"usage":{"inputTokens":...,"outputTokens":...,"thinkingTokens":...},"durationMs":...,"ttftMs":...,"model":"...","costEstimate":{"input":...,"output":...,"thinking":...,"total":...}}
```

### API Changes

**`/api/agents/[id]/playground/route.ts`:**
- Wrap AI SDK stream to intercept token usage and timing metadata
- Emit `execution_start` before streaming begins
- Emit `execution_end` after stream completes with aggregated metrics
- For graph agents: surface GraphExecutor node events as `tool_call`/`tool_result`
- Capture and emit thinking events when model supports extended thinking
- Include request/response metadata in headers for Raw tab:
  - `x-execution-id`: Execution ID
  - `x-model-id`: Resolved model ID
  - `x-request-timestamp`: Request start time

**Cost calculation utility:**
- Maps model ID + token counts to estimated USD cost
- Uses pricing from LLM provider settings (already exists in the system)
- Fallback to hardcoded defaults for known models (Bedrock Claude pricing)

### No Persistence Changes

The console is ephemeral — all data lives in client state during the playground session. Existing `agentExecution` records continue to store trace/output for execution history. No new database tables or migrations needed.

## State Management

### Extended `usePlayground` Hook

New return values added to the existing hook:

```typescript
interface ConsoleEvent {
  id: string;
  messageId: string;
  timestamp: number;
  relativeMs: number;
  severity: 'info' | 'warn' | 'error';
  type: string;
  data: Record<string, unknown>;
}

interface MessageMetrics {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  ttftMs: number;
  durationMs: number;
  model: string;
  costEstimate: { input: number; output: number; thinking: number; total: number };
}

interface SessionMetrics {
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  avgTokensPerMessage: number;
  avgLatencyMs: number;
  tokensByMessage: Array<{ messageId: string; input: number; output: number; thinking: number }>;
  latencyByMessage: Array<{ messageId: string; durationMs: number }>;
}
```

The hook captures all SSE events during streaming and derives metrics from `execution_end` events.

### New `useConsole` Hook

Manages console UI state separately:

- `activeTab`: 'events' | 'raw' | 'trace' | 'metrics'
- `selectedMessageId`: string | null
- `eventFilters`: { severity: Set, eventType: Set }
- `filteredEvents`: derived from consoleEvents + selectedMessageId + filters
- `rawData`: { request, response, sseStream } per message
- `isAutoScrolling`: boolean

### Resizable Panel Hook

Lightweight `useResizable` hook:
- Tracks panel sizes via pointer events on drag handles
- Persists to localStorage (key: `playground-panel-sizes`)
- Respects min/max constraints
- No external dependencies

## Components to Create

| Component | Location | Purpose |
|-----------|----------|---------|
| `PlaygroundConsole` | `components/agents/playground/console.tsx` | Container with tab navigation |
| `ConsoleEvents` | `components/agents/playground/console-events.tsx` | Structured event log |
| `ConsoleRaw` | `components/agents/playground/console-raw.tsx` | Raw protocol viewer |
| `ConsoleTrace` | `components/agents/playground/console-trace.tsx` | Execution trace tree |
| `ConsoleMetrics` | `components/agents/playground/console-metrics.tsx` | Metrics dashboard |
| `MessageMetadataBar` | `components/agents/playground/message-metadata-bar.tsx` | Per-message footer |
| `ThinkingBlock` | `components/agents/playground/thinking-block.tsx` | Collapsible thinking display |
| `ResizablePanel` | `components/ui/resizable-panel.tsx` | Generic resizable split panel |

## Components to Modify

| Component | Change |
|-----------|--------|
| `app/(dashboard)/agents/[id]/playground/page.tsx` | Replace right sidebar with split panel layout |
| `app/(dashboard)/agents/playground/page.tsx` | Use ChatBubble with markdown support |
| `hooks/use-playground.ts` | Capture console events and metrics from SSE stream |
| `components/chat/chat-messages.tsx` | Support message selection and metadata bar |
| `app/api/agents/[id]/playground/route.ts` | Emit enhanced SSE events with metadata |

## Testing Strategy

- Unit tests for `useConsole` hook (event filtering, metrics computation)
- Unit tests for cost calculation utility
- Integration test for enhanced SSE stream (verify all event types emitted)
- Manual verification of markdown rendering, panel resizing, and message-console linking
