# Model Field: Custom ID Entry

**Date:** 2026-05-30  
**Status:** Approved

## Problem

Model IDs in the Bedrock ecosystem change over time. The discovered model list can lag behind or miss inference profile IDs entirely. Agents configured with a custom model ID (e.g. `us.amazon.nova-pro-v1:0`) have no way to express that in the current dropdown-only UI.

## Design

### Single editable field (Option C, C2 commit)

`ProviderModelSelect` becomes a single field that does two things:
- **Typing filters** the discovered model list in real time
- **Any value** can be committed as a custom model ID — no mode switching

### States

| State | Appearance |
|---|---|
| Closed, discovered model | Model name + chevron |
| Closed, custom ID | Model ID + amber "custom" badge + chevron |
| Open, query matches list | Filtered dropdown list |
| Open, no match | "No discovered models match — press Enter or click away to use this ID" |

### Interaction rules

1. Clicking the field opens the dropdown and focuses the search input
2. Typing filters discovered models in real time (case-insensitive, matches name or ID)
3. Clicking a discovered model selects it, closes dropdown, clears any "custom" badge
4. If typed value matches nothing: pressing **Enter** or the combobox **closing** (click away) commits it as a custom ID
5. Committed custom ID shows amber "custom" badge at rest
6. Re-opening when a custom ID is set: pre-fills the search input with the current ID for editing
7. **Escape** closes dropdown without changing the current value
8. **Empty input + close**: reverts to previous value — no accidental clear

### API surface

No changes to callers. `ProviderModelSelect` keeps the same props:

```ts
interface ProviderModelSelectProps {
  capability: ModelCapability;   // 'chat' | 'embedding'
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}
```

The custom ID is just a string value identical to any discovered model ID from the caller's perspective.

## Implementation scope

- `apps/web-ui/components/llm-providers/provider-model-select.tsx` — only file changed
- No changes to `simple-agent-form.tsx`, `llm-node-form.tsx`, or knowledge-base pages
- No new dependencies

## Out of scope

- Validating whether a custom model ID actually exists in AWS
- Persisting a "favourites" list of custom IDs
- Showing custom IDs in the dropdown list across sessions
