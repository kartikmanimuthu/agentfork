# Router NLP classifier: prompt fix + configurable model dropdown

**Date:** 2026-05-26
**Type:** bugfix + feature
**Files:**
- `libs/agent-studio/src/execution/node-executors/router-executor.ts` — fix NLP prompt, use `classifierModel`
- `libs/agent-studio/src/types/nodes.ts` — add `classifierModel?: string` to `RouterNodeConfig`
- `libs/agent-studio/src/registry/schemas/router.ts` — add `classifierModel` to Zod schema
- `apps/web-ui/components/agents/config/router-node-form.tsx` — replace text input with `ProviderModelSelect` dropdown

## What changed

**Bug fix — NLP prompt:** The router's NLP classifier was building context from `channels`, which included the user's message buried in a JSON array: `messages: [{"role":"user","content":"..."}]`. The LLM classifier received this as raw JSON in the prompt and had no explicit signal that this was the user's query. At low temperature (0.1) it would often interpret the condition too literally and return -1 (no match), silently falling to the default target every time.

Fixed by extracting the last user message from `state.messages` and presenting it explicitly as `User's message: "..."` in the prompt. Non-message channels are still included as additional context but the messages array itself is excluded to avoid duplication.

**Bug fix — default provider:** The router called `ctx.services.llmProvider()` with no model argument, which resolves to the tenant's default LLM provider. If no default is configured (or the default uses a deprecated/legacy Bedrock model), the classification call fails with an empty response. An empty response parses as `NaN`, which is treated as -1, which falls to default — silently, with no visible error.

Fixed by adding a `classifierModel?: string` field to `RouterNodeConfig`. When set, the router calls `ctx.services.llmProvider(undefined, config.classifierModel)` which resolves the provider that has that model — the same lookup used by LLM nodes.

**Feature — model dropdown:** The router form in NL mode now shows a `ProviderModelSelect` dropdown (same component used in the LLM node form) instead of a free-text input. It groups chat models by provider and stores just the model ID in config. This ensures the user can only select a model that's actually configured, and they don't have to know the exact model ID string.

## Why

The router was always routing to the default target in NL mode regardless of the user's message. Root cause (confirmed in logs):

```
No default LLM provider configured
→ falls through to Bedrock legacy config
→ Access denied. This Model is marked by provider as Legacy
→ response: ""  →  parsedIndex: null  →  matchedTarget: default LLM
```

Two separate problems compounded: the prompt wasn't clear enough about where the user's query was, and the model being called was dead. Users had no way to specify which model the router should use — it was always the (potentially broken) default.

## Research

- **LangGraph routing**: Uses a dedicated `LLM` call with an explicit system prompt that names the user query clearly — not a raw channel dump. Condition matching is framed as classification, not open-ended reasoning.
- The prompt now follows the same pattern: state the user's message plainly, list conditions as numbered options, ask for an index. Keeps temperature at 0 (or `nlTemperature`) for deterministic output.
- `ProviderModelSelect` was already used in `LlmNodeForm` — reused directly with no changes needed to the component.

## Watch for

- If `classifierModel` is not set, the router falls back to `llmProvider()` with no model — which hits the default provider. If the default provider is broken or unset, classification silently falls to the default target. Users should always set a classifier model in NL mode.
- The NLP prompt asks for "ONLY a single integer". Some models (especially creative/chat-tuned ones at temperature > 0) add explanatory text. `parseInt` handles leading numbers correctly (`"0 because..."` → 0) but not trailing (`"The answer is 0"` → NaN → falls to default). Keep `nlTemperature` at 0 for reliable output.
- The fix excludes `channels.messages` from the extra context block to avoid showing the messages twice (once in the explicit user query line, once as a JSON blob). Any channel with key `messages` is filtered. If a user creates a custom channel named `messages`, it won't appear in the router context.
