# Node Executor Gaps — Backlog

Tracked here until each item gets a proper plan/change doc.

---

## Partially done (small fixes, no design needed)

### KB → threshold not passed
`libs/agent-studio/src/execution/node-executors/knowledge-base-executor.ts`

The retrieval service fully supports `similarityThreshold` in its SQL query. The KB node config has a `threshold?: number` field. But the executor never passes it:

```ts
// current
const results = await retrieval.query(query, { knowledgeBaseId: kbId, topK: config.topK });

// fix
const results = await retrieval.query(query, { knowledgeBaseId: kbId, topK: config.topK, similarityThreshold: config.threshold });
```

One argument. No other files need touching.

---

### Input → structured mode doesn't parse JSON
`libs/agent-studio/src/execution/node-executors/input-executor.ts`

In `structured` mode the executor assigns the entire raw message string to every schema field instead of parsing JSON from the message:

```ts
// current — every field gets the whole message content
updates[field.name] = lastUserMessage.content;

// fix — try JSON.parse first, extract matching key, fall back to raw content
try {
  const parsed = JSON.parse(lastUserMessage.content);
  updates[field.name] = parsed[field.name] ?? lastUserMessage.content;
} catch {
  updates[field.name] = lastUserMessage.content;
}
```

---

## Stubs — need proper plans before touching

### LLM → tool calling
`config.tools: string[]` exists but is never wired into `provider.streamChat()`. Needs:
- A tool registry or lookup (what does `tools: ['search', 'calculator']` resolve to?)
- `streamChat` extended to accept tool definitions
- Tool result handling in the LLM execution loop

Plan this before building.

### Parallel node — fan-out/join
Current executor dispatches `next: config.branches` but `resolveNextNode()` only picks `next[0]`. Actual parallelism needs fan-out (run all branches concurrently via `Promise.all`) + a join strategy (wait for all, merge outputs). Significant graph executor change.

### Sub-Agent node
Placeholder. Needs recursive `GraphExecutor` invocation with context isolation (separate `executionId`, `tenantId` scoping, depth limit to prevent infinite loops).

### Tool node
Placeholder. Depends on a tool registry being built first — no point implementing the executor without a store to look tools up from.
