# Merge Tracking: omar-updating-graph-agent ← bitbucket/main

**Date:** 2026-06-02  
**Branch:** `omar-updating-graph-agent`  
**Operator:** Claude (automated merge)  
**Status:** IN PROGRESS

---

## Pre-Merge State

```
omar-updating-graph-agent HEAD: 7135a17
bitbucket/main HEAD: 8be1225
Common ancestor: 0b1e8f6
```

---

## Commit 1 — Foundation Layer

**Files:**
- `prisma/schema.prisma`
- `libs/shared/src/index.ts`
- `libs/shared/src/validation/schemas/agents.ts`
- `libs/ai/src/providers/bedrock.ts` *(Omar's version kept — main's discarded)*
- `apps/web-ui/components/llm-providers/provider-model-select.tsx` *(main's version taken)*
- `apps/workers/tsconfig.json`
- `.env.example`
- `package.json`

**SHA before:** 7135a17  
**SHA after:** TBD  

**Revert command:**
```bash
git revert <SHA>
# or
git reset --hard 7135a17
```

---

## Commit 2 — API Routes

**Files:**
- `apps/web-ui/app/api/v1/inference/route.ts`
- `apps/web-ui/app/api/agents/[id]/playground/route.ts`

**SHA before:** (Commit 1 SHA)  
**SHA after:** TBD  

**Revert command:**
```bash
git revert <SHA>
```

---

## Commit 3 — UI Layer

**Files:**
- `apps/web-ui/hooks/use-playground.ts`
- `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx`

**SHA before:** (Commit 2 SHA)  
**SHA after:** TBD  

**Revert command:**
```bash
git revert <SHA>
```

---

## Post-Merge

```bash
bun install   # regenerate bun.lock
```

**bun.lock SHA after:** TBD

---

## Key Decisions Log

| File | Decision |
|---|---|
| `bedrock.ts` | Kept Omar's — main uses removed `maxSteps` API (AI SDK v5+ removed it) |
| `provider-model-select.tsx` | Took main's Combobox — identical props interface, pure enhancement |
| `targetCommand` schema | Kept Omar's `.optional()` — runtime never reads it, form UI treats as optional |
| `httpBridgeTransportSchema` type | Changed `targetCommand: string` → `targetCommand?: string` |
| `inference/route.ts` graph block | Omar's real GraphExecutor replaces main's fake simulation |
| `playground/route.ts` graph block | Merged: main's SSE events + Omar's onPause callback |
| `use-playground.ts` | Merged: Omar's pauseInfo/handleResume + main's consoleEvents/metrics |
| `playground/page.tsx` | Merged: Omar's HITL banner + main's PlaygroundConsole sidebar |

---

## Rollback Notes

If a specific commit needs reverting:
1. `git log --oneline` to find the SHA
2. `git revert <SHA>` creates a new revert commit (safe for shared branches)
3. Do NOT use `git reset --hard` if the branch has been pushed

If reverting everything:
```bash
git reset --hard 7135a17
git push --force-with-lease  # only if branch not shared with others
```
