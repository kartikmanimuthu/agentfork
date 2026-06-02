# RAG context injection via contextChannels on LLM node

**Date:** 2026-05-25
**Type:** feature
**Files:**
- `libs/agent-studio/src/types/nodes.ts`
- `libs/agent-studio/src/registry/schemas/llm.ts`
- `libs/agent-studio/src/execution/node-executors/llm-executor.ts`
- `apps/web-ui/components/agents/config/llm-node-form.tsx`

## What changed
`LlmNodeConfig` gains an optional `contextChannels: string[]` field. The LLM executor now reads each listed channel from `ctx.state.channels`, formats non-empty string values as `<documents>` XML, and prepends the block to the last user message before the API call. The system prompt is untouched. The LLM node config form shows a "Context Channels" section with add/remove rows.

## Why
KB nodes write retrieved text to `channels['kb_results']` but the LLM executor only read `ctx.state.messages`. Retrieved context was never seen by the LLM — RAG was wired in the graph but produced zero benefit.

## Research
- LangGraph canonical RAG: retrieve node writes to `state.retrieved_docs`, generate node reads it and builds prompt. Source-of-truth is the typed state dict — nodes are decoupled, the generate node declares what it reads.
- Injection placement: all three providers (Anthropic, OpenAI, Google) recommend documents in the user turn, not system prompt. Keeps system prompt stable for prompt caching (75–90% cost discount at scale). Documents in user turn are treated as data, not instructions — reduces prompt injection risk from KB content.
- `<documents>` XML format: Anthropic explicitly recommends it; OpenAI and Gemini models handle it correctly. Degrades gracefully on small/open-source models (text still injected, delimiter semantics may not be parsed).
- Works across all providers: injection is plain string manipulation on the messages array before the SDK call. Provider-specific prompt template formatting is handled by the serving layer (Ollama, vLLM, Bedrock, etc.).

## Watch for
- Channel values are typed as `unknown`. The executor guards with `typeof === 'string'`. Non-string values (objects, arrays from Code nodes) are silently skipped.
- Injection is constructed fresh on every LLM node execution — it does NOT persist into `state.messages`. This is intentional: KB retrieval should be re-run and re-injected per turn.
- If a future node writes per-chunk structured output to a channel (array of strings), a richer format (one `<document>` per chunk) would be a follow-on spec.
