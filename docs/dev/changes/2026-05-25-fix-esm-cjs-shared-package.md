# Fix ESM/CJS mismatch for @chatbot/shared in workers

**Date:** 2026-05-25
**Type:** bugfix
**Files:** `libs/shared/package.json`, `libs/shared/src/logging/logger.ts`, `apps/workers/src/lib/logger.ts`, `apps/workers/package.json`

## What changed

- Created `libs/shared/package.json` with `"type": "module"` — shared is now treated as ESM by Node.js
- Changed `require('pino')` to `import pino from 'pino'` in `libs/shared/src/logging/logger.ts` (CJS require is not valid in ESM)
- Rewrote `apps/workers/src/lib/logger.ts` to use pino directly instead of importing `createLogger` from `@chatbot/shared/workers`
- Added `pino` and `pino-pretty` as direct deps in `apps/workers/package.json`

## Why

Workers (`apps/workers`) has `"type": "module"` and runs as ESM. `libs/shared` had no `package.json`, so Node.js defaulted it to CJS. tsx compiles CJS modules using a `__toCommonJS()` wrapper pattern — ESM static imports cannot resolve named exports from such modules at runtime.

This caused workers to crash on startup with:
```
SyntaxError: The requested module '@chatbot/shared/workers' does not provide an export named 'createLogger'
```

The fix makes shared fully ESM so both workers (Node.js/tsx) and Next.js (webpack via `transpilePackages`) can import from it without issues.

## Research

- Node.js ESM/CJS interop: static `import { name }` from a CJS module fails when the module uses `__toCommonJS()` (tsx compiled). Dynamic `import()` works but requires async restructuring.
- Adding `"type": "module"` to a package's `package.json` is the standard fix — it tells Node.js to treat all `.js`/`.ts` files in that package as ESM.
- Next.js `transpilePackages` handles both CJS and ESM source packages via webpack, so changing shared to ESM does not break the web-ui build.
- Workers logger was rewritten to be self-contained because it was the first import in the chain that failed — simpler to cut the dependency than fix it at the shared level first.

## Watch for

- Any new file added to `libs/shared/src/` must not use `require()` — it's now an ESM package.
- If `libs/ai` or another lib has a similar missing `package.json`, the same crash can happen when imported by an ESM consumer.
