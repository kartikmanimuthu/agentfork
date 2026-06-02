# Auto-wire KB outputChannel → LLM contextChannels on edge connect

**Date:** 2026-05-25
**Type:** feature
**Files:** `apps/web-ui/components/agents/canvas/agent-canvas.tsx`, `apps/web-ui/components/agents/config/knowledge-base-node-form.tsx`, `libs/agent-studio/src/execution/node-executors/output-executor.ts`

## What changed

- When a KB node is connected to an LLM node on the canvas, the KB's `outputChannel` is automatically added to the LLM's `contextChannels` — no manual wiring needed
- When that edge is deleted, the channel is automatically removed from `contextChannels`
- Fixed `OutputNodeExecutor` — it was re-emitting the full LLM response as a `text_delta`, causing every graph agent response to appear doubled in the UI
- Fixed the KB node config panel — "Threshold (none)" was rendering as a broken radio button; replaced with a slider that shows the current value and a "use KB default" clear option

## Why

Graph agents with KB → LLM → Output were silently broken in two ways:
1. The KB retrieved content but the LLM never received it because `contextChannels` wasn't wired
2. Even when it worked, the response appeared twice because both the LLM (streaming tokens) and the Output node (re-emitting the full text) fired `text_delta` events

Every production visual workflow tool (n8n, LangGraph Studio, Flowise) auto-wires data flow when nodes are connected via edges. Requiring manual channel configuration is a footgun — easy to forget, impossible to debug from the UI.

## Watch for

- If a KB node's `outputChannel` is changed after the edge is drawn, the LLM's `contextChannels` won't auto-update — user needs to reconnect the edge
- If multiple KB nodes connect to the same LLM node, each adds its own channel to `contextChannels` (correct behavior)
- The Output node no longer emits `text_delta` — graphs where a non-streaming node (Code, HTTP) writes to the response channel and the Output node is the only emitter will need the Output node emit restored or those nodes to emit their own events
