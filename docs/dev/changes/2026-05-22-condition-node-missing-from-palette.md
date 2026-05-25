# Condition node missing from canvas palette

**Date:** 2026-05-22
**Type:** bugfix
**Files:** `libs/agent-studio/src/registry/node-registry.ts`

## What changed
Added `condition` entry to the `definitions` array in `NodeRegistry`. It now appears in the canvas node palette between Router and State Schema.

## Why
The Condition node was fully implemented (executor, form, canvas component, Zod schema) but never registered in `definitions`. `NodeRegistry.getAll()` drives the palette — if a type isn't in `definitions`, it's invisible to users even though the rest of the code is ready.

## Research
This is a standard registry/plugin pattern — the schema union and the palette definitions are two separate lists that must both be updated when adding a node type. Same pattern used by n8n (node descriptor vs node implementation) and LangGraph (node registration vs node definition). The fix is minimal: one entry in `definitions`.

## Watch for
Any future node type addition needs entries in three places: `definitions[]` in node-registry.ts, `nodeTypes` in node-types.ts, and the executor registration. Missing any one of the three causes silent partial failures (node invisible, node renders but crashes, or node runs but produces no output).
