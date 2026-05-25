# RAG Context Injection — LLM Node Design Spec

**Date:** 2026-05-25
**Scope:** `LlmNodeConfig`, `llm-executor.ts`, `llm-node-form.tsx`, Zod schema, node registry
**Status:** Draft

---

## Problem

The graph execution pipeline has a structural disconnect between the KB node and the LLM node:

- **KB node** retrieves documents and writes them to `state.channels[outputChannel]` (e.g. `channels.kb_results`)
- **LLM node** reads only `ctx.state.messages` — it never reads `channels`

Result: KB retrieval runs, writes text to state, LLM ignores it, answers from training memory only. RAG is wired in the graph but produces zero benefit.

The same gap applies to any future channel-producing node (HTTP, Code, MCP) that wants to feed context into an LLM.

---

## Design Decision: Explicit Channel Wiring

The user explicitly lists which channels to inject on each LLM node via a `contextChannels` config field. No auto-detection.

**Why explicit over implicit:**
- A routing graph has multiple LLM nodes. Only the RAG branch node should receive KB context; greeting/small-talk branches should not. Implicit injection would pollute all of them.
- Debuggable: the config is the source of truth, not executor heuristics.
- Generalises: any channel (KB, HTTP, Code, MCP) can feed any LLM node. No special-casing per node type.
- Matches how LangGraph, Flowise, and n8n handle this — all three require explicit wiring between retriever output and LLM input.

---

## Injection Strategy: Prepend to Last User Message

**Where:** Modify the last user message in the messages array before the API call. System prompt is untouched.

**Why not system prompt:**
- System prompt must be stable per-turn for prompt caching to work (Anthropic 75–90% discount, OpenAI equivalent). KB results change per query — injecting into the system prompt invalidates the cache on every call.
- Documents in the user turn are treated as *data* by all models; in the system prompt they carry more authority, raising prompt-injection risk from malicious KB content.
- This pattern is used by LangGraph's canonical RAG example, Haystack's ConversationalRAG pipeline, and Open-WebUI (supports 50+ providers).

**Why this works on all providers:**
- Injection is plain string manipulation on the `messages` array before the SDK call. Every provider that supports chat completions (OpenAI, Anthropic, Gemini, Mistral, Cohere, Bedrock, Ollama, vLLM) receives standard `{role, content}` objects — the serving layer handles any model-specific prompt template conversion.
- `<documents>` XML tags are understood by all frontier models and degrade gracefully on smaller models (text still injected, delimiter semantics may not be parsed, but context is still present).

---

## Data Flow

```
Graph execution:
  KB node → channels['kb_results'] = "retrieved text..."
  LLM node config: contextChannels = ['kb_results']

LLM executor (at call time):
  1. Read each channel listed in contextChannels from ctx.state.channels
  2. Filter out empty/null values
  3. Format as XML document block
  4. Find last user message in messages array
  5. Prepend XML block to its content
  6. Call streamChat with modified messages, unchanged system prompt
```

**Formatted injection:**

```
<documents>
<document index="1">
{channel content}
</document>
<document index="2">
{second channel content, if multiple}
</document>
</documents>

{original user message content}
```

If `contextChannels` is empty, undefined, or all listed channels are empty strings, the executor skips injection entirely — behaviour is identical to today.

If there is no user message in the messages array (edge case: graph started with only system/assistant messages), injection is skipped and a warning is logged.

---

## Files Changed

| File | Change |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Add `contextChannels?: string[]` to `LlmNodeConfig` |
| `libs/agent-studio/src/registry/schemas/llm.ts` | Add `contextChannels: z.array(z.string()).optional()` to Zod schema |
| `libs/agent-studio/src/registry/node-registry.ts` | No change to `defaultConfig` (field is optional, omitted by default) |
| `libs/agent-studio/src/execution/node-executors/llm-executor.ts` | Read `config.contextChannels`, build XML block, prepend to last user message |
| `apps/web-ui/components/agents/config/llm-node-form.tsx` | Add "Context Channels" UI section: list of text inputs with Add/Remove, same pattern as router conditions |

---

## LLM Executor Logic (precise)

```typescript
// Inside execute(), before streamChat call:

const contextChannels = config.contextChannels ?? [];
const channelContents = contextChannels
  .map((ch) => ({ ch, content: ctx.state.channels[ch] }))
  .filter((e): e is { ch: string; content: string } =>
    typeof e.content === 'string' && e.content.trim().length > 0
  );

let messages = ctx.state.messages.map((m) => ({ role: m.role, content: m.content }));

if (channelContents.length > 0) {
  const lastUserIdx = [...messages].map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'user')
    .at(-1)?.i ?? -1;

  if (lastUserIdx !== -1) {
    const docBlock = channelContents
      .map((e, i) => `<document index="${i + 1}">\n${e.content}\n</document>`)
      .join('\n');
    const xmlBlock = `<documents>\n${docBlock}\n</documents>`;

    messages = [
      ...messages.slice(0, lastUserIdx),
      { role: 'user', content: `${xmlBlock}\n\n${messages[lastUserIdx].content}` },
      ...messages.slice(lastUserIdx + 1),
    ];

    logger.debug(
      { nodeId: ctx.node.id, channels: contextChannels, docCount: channelContents.length },
      'injected context channels into last user message',
    );
  } else {
    logger.warn(
      { nodeId: ctx.node.id, channels: contextChannels },
      'contextChannels configured but no user message found to inject into — skipping',
    );
  }
}
```

---

## UI (llm-node-form.tsx)

A "Context Channels" section below System Prompt. Each entry is a plain text input (channel name string, e.g. `kb_results`). Add button appends an empty input. Remove button (×) on each row deletes it. Saves on blur, matching the existing form's `handleBlur` pattern.

No NodePicker here — channel names are the string values the user set in upstream node configs (e.g. the KB node's `outputChannel` field, which defaults to `kb_results`). The user types the same string here. A future enhancement could auto-populate a picker from upstream node configs, but that requires graph-topology analysis and is out of scope.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| `contextChannels` is `[]` or `undefined` | No injection, identical to today |
| Listed channel has no value yet (KB hasn't run) | Empty string filtered out, skipped silently |
| Listed channel value is not a string (e.g. object) | Filtered out, skipped silently |
| No user message in messages array | Injection skipped, `logger.warn` emitted |
| Multiple channels listed | All injected as separate `<document>` blocks in one `<documents>` wrapper |
| Provider does not support system message | Unaffected — injection is on user message, system is a separate param |

---

## Testing

- Unit test `llm-executor.ts`: assert that when `contextChannels: ['kb_results']` and `channels.kb_results = 'some text'`, the messages array passed to `streamChat` has the XML block prepended to the last user message content, and `system` is unchanged.
- Unit test: empty channel value → no injection.
- Unit test: no user message in array → skip + warn.
- Unit test: multiple channels → multiple `<document>` blocks.
- Manual: KB → LLM graph in playground, confirm LLM answer references KB content.

---

## Watch For

- `channels` values can be any type (`Record<string, unknown>`). The executor must `typeof === 'string'` guard before injecting — non-string channel values (objects from Code node, etc.) should be skipped or JSON-serialised in a future enhancement.
- If a future node writes multi-part structured output to a channel (e.g. an array of chunks), this design injects it as a raw string. A richer format (e.g. one `<document>` per chunk) would be a follow-on spec.
- Injecting context per-turn means the injected text does NOT persist in `state.messages` — it is constructed fresh each time the LLM node runs. This is intentional: KB results should be re-retrieved and re-injected per turn, not cached across turns.
