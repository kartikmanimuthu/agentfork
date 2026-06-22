# Node picker dropdowns + unique label enforcement

**Date:** 2026-05-22
**Type:** feature
**Files changed:**
- `apps/web-ui/components/agents/config/node-picker.tsx` (new)
- `apps/web-ui/components/agents/config/router-node-form.tsx`
- `apps/web-ui/components/agents/config/condition-node-form.tsx`
- `apps/web-ui/components/agents/config/parallel-node-form.tsx`
- `apps/web-ui/components/agents/config/config-panel.tsx`
- `apps/web-ui/components/agents/canvas/agent-canvas.tsx`

## What changed
Router, Condition, and Parallel node config forms now show a dropdown of all other canvas nodes (label · type, stores ID) instead of free-text node ID inputs. Dropping or duplicating a node auto-generates a unique label suffix if a same-name node already exists. The config panel header now shows the node ID in small monospace text.

## Why
Users had no way to see node IDs in the UI, so filling in target fields required copy-pasting from the browser dev tools. Duplicate labels with no ID visibility made it impossible to distinguish nodes in routing config.

## Research
- Checked how n8n and LangGraph Studio handle node references in flow config: both store node IDs internally but surface human-readable labels in all UI controls, with the ID shown only in a secondary position (inspector/tooltip). Followed same pattern.
- React Flow `Node.data` shape used as source of truth for the picker list — avoids a separate sync layer.
- Unique label suffix pattern (`Name 2`, `Name 3`) matches VS Code's file duplicate behavior and Figma's layer naming — both production references for this pattern.
- Considered UUID-based display (show truncated ID always) — rejected because it's harder to read at a glance and the label+type combo is unambiguous within a single graph.

## Watch for
- `ConfigPanel` receives `allNodes` filtered from `rfNodes` (React Flow local state). If a future change syncs nodes through the Zustand store instead, the picker list will go stale unless `allNodes` prop is updated at that call site too.
- Parallel branches changed from a comma-string to `string[]` in form state. If any code serialises/deserialises `ParallelNodeConfig.branches` as a string elsewhere, it will silently break.
