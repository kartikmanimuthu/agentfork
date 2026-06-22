# AI SDK v6: Fix tool definitions using deprecated `parameters` property

**Date:** 2026-06-09
**Type:** bugfix
**Files:** `apps/web-ui/app/api/v1/inference/route.ts`

## What changed

Renamed `parameters` → `inputSchema` in the `generate_spreadsheet` and `generate_pdf` tool definitions inside the simple agent LLM SSE path.

## Why

The widget live preview (and any SDK widget chat) was broken — every message returned:

```
AI_APICallError: The value at toolConfig.tools.X.toolSpec.inputSchema.json.type
must be one of the following: object.
```

`generate_spreadsheet` and `generate_pdf` are registered unconditionally on every simple agent inference request. Both used the old AI SDK v4 property `parameters` to define their input schema. In AI SDK v6, `parameters` was renamed to `inputSchema` (breaking change in v5.0). AI SDK v6 silently ignores `parameters`, so Bedrock received tools with an empty/undefined schema and rejected the entire request.

The playground was unaffected because it uses a separate route (`/api/agents/[id]/playground/route.ts`) that does not register these tools.

## Research

- Verified in AI SDK v6 migration docs: [Migration Guide 5.0](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/26-migration-guide-5-0.mdx) — `parameters` → `inputSchema` is a documented breaking change
- Project is on `"ai": "^6.0.174"` — confirmed v6
- `jsonSchema()` helper from `ai` is unchanged — only the property name on the tool object changed
- GitHub `origin/main` has the same bug (uses `parameters`) — any deployment from GitHub main would have the same widget failure

## Watch for

- Any other tool definitions in the codebase using `parameters` instead of `inputSchema` — search for `parameters: jsonSchema(` or `parameters: z.` in tool objects
- The `mcp-client.service.ts` already uses `inputSchema` correctly (fixed in the Omar branch)
- If AI SDK is upgraded beyond v6, check the migration guide for further tool API changes
