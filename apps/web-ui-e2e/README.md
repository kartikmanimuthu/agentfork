# web-ui-e2e

End-to-end tests for the `web-ui` Next.js app, built with [Playwright](https://playwright.dev/) and wired into the Nx monorepo.

The suite is organized **module-by-module** (mirroring the web-ui route groups) with a shared infrastructure layer. Every test is **tagged** so you can run or skip individual product modules and priority slices.

---

## Quick start

```bash
# 1. Start the app (once, leave running) — serves on http://localhost:3005
bun run dev          # web-ui only
# or
bun run dev:all      # web-ui + workers + SDK (what the e2e webServer launches)

# 2. Run the whole suite (reuses the running server locally)
bun run e2e:dev
```

That's the fast local loop. `e2e:dev` skips the Nx build step and assumes a dev server is up. If no server is running, Playwright starts `bun run dev:all` itself (the first run is slow — it boots the full stack).

> All commands below are run from the **repo root** unless noted.

---

## Commands

### Top-level

| Command | What it does |
|---|---|
| `bun run e2e` | **CI mode** — builds the app first (`^build`), runs headless against the production server. |
| `bun run e2e:dev` | **Local mode** — no build step; runs against the dev server (starts it if absent). |
| `bun run e2e:ui` | Opens the Playwright **UI mode** (interactive runner + time-travel debugger). |
| `bun run e2e:codegen` | Launches the **codegen recorder** against `http://localhost:3005`. |

### Run / skip a module

Each product module has its own target:

| Command | Runs only |
|---|---|
| `bun run e2e:auth` | `@auth` — login & register pages |
| `bun run e2e:sso` | `@sso` — Cognito SSO login/logout |
| `bun run e2e:marketing` | `@marketing` — landing page |
| `bun run e2e:docs` | `@docs` — documentation pages |
| `bun run e2e:navigation` | `@navigation` — route guards & redirects |
| `bun run e2e:api` | `@inference-api` — API auth checks |

### Run by priority

| Command | Runs only |
|---|---|
| `bun run e2e:smoke` | `@smoke` — fast critical-path tests |
| `bun run e2e:regression` | `@regression` — fuller coverage |

### Ad-hoc filtering

The config reads `E2E_GREP` / `E2E_GREP_INVERT`, so you can filter without a dedicated target:

```bash
E2E_GREP=@docs bun run e2e:dev               # run only @docs
E2E_GREP_INVERT=@sso bun run e2e:dev         # run everything EXCEPT @sso
E2E_GREP="@smoke" E2E_GREP_INVERT="@sso" bun run e2e:dev
```

Or pass `--grep` straight through Playwright from inside the project:

```bash
cd apps/web-ui-e2e
bunx playwright test --grep @smoke
bunx playwright test --grep-invert @sso
bunx playwright test --grep "@auth|@marketing"        # OR (alternation)
bunx playwright test --grep "(?=.*@smoke)(?=.*@auth)" # AND (lookahead)
bunx playwright test src/modules/docs/docs.spec.ts    # a single file
bunx playwright test --list                           # list without running
```

> `--grep` matches against both the test title **and** its tags.

---

## Recording new tests (codegen)

The fastest way to author a test is to record clicks and copy the generated code.

```bash
# 1. App must be running on :3005
bun run dev

# 2. Open the recorder
bun run e2e:codegen
# (equivalent: cd apps/web-ui-e2e && bunx playwright codegen http://localhost:3005)
```

Click through the flow in the browser, copy the generated snippet from the inspector, then paste it into the right module spec and adapt it to the conventions below (fixtures, tags, helpers).

> Codegen does **not** start the `webServer` — that only happens during `playwright test` runs. Start the server yourself first.

### Prompt template — handing a recording to an agent

Paste this into a new chat/session along with the raw codegen snippet. You don't need to know the module name, the target file, or whether a spec already exists for this flow — the agent figures that out by inspecting the repo. Self-contained — works even if the agent hasn't read this file yet.

```
Convert this Playwright codegen recording into a proper e2e test for
this project (apps/web-ui-e2e), following its existing conventions —
see apps/web-ui-e2e/README.md for the full reference if anything below
is unclear.

What I was testing: <one sentence, e.g. "viewing the Custom Dashboards
list and opening one">

First, figure out where this belongs before writing anything — the
e2e suite (apps/web-ui-e2e) only has test code for features someone
already wrote a test for, so don't rely on it alone:
- List apps/web-ui-e2e/src/modules/ and check src/constants/tags.ts to
  see which modules already exist.
- Also check the real app source at apps/web-ui/app/(dashboard)/ — each
  top-level folder there is a real feature (e.g. mcp-servers, audit,
  analytics, sessions, knowledge-bases) and may have no e2e module yet.
  Use this to name the module even when nothing matches in step 1.
- If apps/web-ui/components/<route-name>/ exists, glance at it for
  distinct sub-flows under the same route (e.g. agents/ contains both
  a simple-agent-form and a graph canvas) so the test lands in the
  right describe block, not lumped in with an unrelated flow.
- Match the recording's URLs/UI against the above — reuse an existing
  module folder if this flow clearly belongs to one already (check its
  existing .spec.ts file for overlap first), otherwise create a new
  src/modules/<module>/ folder and a matching tag in tags.ts.
- Tell me what module/file you decided on and why, before or alongside
  the test — this is your checkpoint to correct a wrong call before
  anything is written.

Raw codegen output:
```ts
<paste the inspector's generated code here>
```

Requirements:
- Import { test, expect } from '../../fixtures/base' (not '@playwright/test').
- Use the `anonPage` fixture for unauthenticated flows, the default `page`
  fixture for authenticated ones — never inline `storageState`.
- Use `ROUTES` constants (src/constants/routes.ts) instead of hardcoded
  URLs; add a new ROUTES entry if the path is missing.
- Replace any hardcoded personal data (real email/password/names) with
  generated unique values, e.g. `` `e2e-${Date.now()}@example.com` `` —
  the test must pass on every run, not just the first.
- Strip recorder noise (duplicate clicks, dblclicks, redundant .click()
  immediately before .fill()).
- Add real `expect(...)` assertions for the end state — the recorder
  only logs actions, never checks anything.
- Tag the describe block per src/constants/tags.ts: one module tag +
  one or more priority tags (@smoke/@regression/@critical/@anon/etc).
- Reuse existing page objects/helpers (src/pages/, src/helpers/) instead
  of inlining selectors, if one already exists for this flow.
- Verify any fragile-looking selector against the real running app
  before finalizing (e.g. the playwright-cli skill, or manual codegen) —
  don't trust the recorder's selectors blindly, especially around
  Radix/Base UI components (checkboxes/selects often have label quirks).
```

---

## Architecture

```
apps/web-ui-e2e/
├── playwright.config.ts        # projects, webServer, timeout, grep, reporters
├── project.json                # Nx targets (e2e, e2e:<module>, e2e:smoke, ...)
├── tsconfig.json
└── src/
    ├── config/
    │   └── env.ts              # typed @t3-oss/env-core — the ONLY place process.env is read
    ├── constants/
    │   ├── tags.ts             # TAG taxonomy (module + priority axes)
    │   └── routes.ts           # ROUTES — centralized path constants
    ├── fixtures/
    │   └── base.ts             # custom test fixtures: anonPage, anonContext, gotoApp
    ├── helpers/
    │   ├── navigation.ts       # gotoPath(page, path)
    │   ├── docs.ts             # gotoDoc(page, path) — nav + 404 assertion
    │   └── auth-token.ts       # mintSessionToken() — NextAuth JWT
    ├── pages/                  # shared page objects (used across modules)
    │   ├── login.page.ts       # LoginPage
    │   └── sso.flow.ts         # SsoFlow (login / logout)
    ├── setup/
    │   └── auth.setup.ts       # mints the session cookie → src/.auth/session.json
    ├── .auth/
    │   └── session.json        # generated auth state (git-ignored)
    └── modules/
        ├── auth/auth.spec.ts
        ├── sso/sso-auth.spec.ts
        ├── marketing/marketing.spec.ts
        ├── docs/docs.spec.ts
        ├── navigation/navigation.spec.ts
        └── inference-api/inference-api.spec.ts
```

Playwright's default `testMatch` only collects `*.spec.ts`, so the `config/`, `constants/`, `fixtures/`, `helpers/`, `pages/` folders are never treated as test files even though they live under `testDir: './src'`.

---

## Authentication model

Auth is set up **once** by the `setup` project before the main tests run:

1. `setup/auth.setup.ts` calls `mintSessionToken()` (`helpers/auth-token.ts`), which mints a NextAuth JWT for an `Owner` test user.
2. The token is written as a `next-auth.session-token` cookie and saved to `src/.auth/session.json`.
3. The `chromium` project loads that `storageState`, so **the default `page` fixture is already authenticated**.

For tests that need an **unauthenticated** session, use the `anonPage` fixture — never declare `test.use({ storageState: { cookies: [], origins: [] } })` inline.

```ts
// authenticated — default page carries the session
test('dashboard loads', async ({ page }) => { ... });

// unauthenticated — fresh empty-storage context
test('redirects to login', async ({ anonPage }) => { ... });
```

The signing secret comes from `NEXTAUTH_SECRET` (default `test-secret-for-e2e`) and is passed to the token subprocess via an env var — not string-interpolated — to avoid shell injection.

---

## Tagging

Two orthogonal axes, defined in `src/constants/tags.ts`:

**Module** (exactly one per spec — lets you run/skip a whole product area):
`@auth` `@sso` `@marketing` `@docs` `@navigation` `@inference-api`

**Type / priority** (one or more per test):
`@smoke` `@regression` `@api` `@critical` `@anon` `@auth-required`

Apply tags at the `describe` level (inherited by every test) and add per-test tags as needed:

```ts
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Auth — Login Page', { tag: [TAG.auth, TAG.anon] }, () => {
  test('renders sign-in form', { tag: [TAG.smoke, TAG.critical] }, async ({ anonPage }) => {
    // ...
  });

  test('SSO button is present', { tag: [TAG.regression] }, async ({ anonPage }) => {
    // ...
  });
});
```

---

## Environment variables

All env access goes through the typed object in `src/config/env.ts` (per the repo's "never read `process.env` directly" rule). Bun auto-loads the repo-root `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3005` | App URL the tests hit. |
| `NEXTAUTH_SECRET` | `test-secret-for-e2e` | Signs the minted session JWT. |
| `E2E_SSO_EMAIL` | `''` | SSO test user — required for `@sso` tests. |
| `E2E_SSO_PASSWORD` | `''` | SSO test password — required for `@sso` tests. |
| `E2E_GREP` | — | Regex passed to Playwright `grep` (run only matches). |
| `E2E_GREP_INVERT` | — | Regex passed to `grepInvert` (skip matches). |
| `CI` | — | When set: enables retries (2), `forbidOnly`, and the junit reporter. |

The `@sso` specs **skip automatically** when `E2E_SSO_EMAIL` / `E2E_SSO_PASSWORD` are absent (`hasSsoCreds()` gate), so a normal run never fails on missing SSO creds. To run them:

```bash
E2E_SSO_EMAIL=you@example.com E2E_SSO_PASSWORD='...' bun run e2e:sso
```

---

## Config highlights (`playwright.config.ts`)

| Setting | Value | Notes |
|---|---|---|
| `testDir` | `./src` | Specs discovered recursively under `modules/`. |
| `timeout` | `90_000` | Global per-test timeout (90s). The `setup` spec keeps its own 90s override. |
| `workers` | `1` | Serial execution. |
| `fullyParallel` | `false` | Single shared session + single dev server. |
| `retries` | `2` in CI, `0` local | |
| `reporter` | `html` + `list` (+ `junit` in CI) | HTML report in `playwright-report/`. |
| `webServer.command` | `cd ../.. && bun run dev:all` | Reused locally (`reuseExistingServer: !CI`). |

---

## Adding a new module

1. Create `src/modules/<module>/<module>.spec.ts`.
2. Import the shared test: `import { test, expect } from '../../fixtures/base';`
3. Tag every `describe` with a module tag (add a new one to `src/constants/tags.ts` if needed) plus priority tags.
4. Use `anonPage` for unauthenticated flows, `page` for authenticated ones.
5. Add paths to `src/constants/routes.ts`; reuse/extend helpers and page objects rather than inlining.
6. (Optional) Add an `e2e:<module>` target to `project.json` and a matching root script in `package.json`.

---

## Debugging

```bash
cd apps/web-ui-e2e

bunx playwright test --ui                       # interactive UI (best for triage)
bunx playwright test --debug                    # step through with the inspector
bunx playwright test --headed                   # watch the browser
bunx playwright show-report                      # open the last HTML report
bunx playwright test --grep @docs --trace on    # force-capture traces
```

Traces and screenshots are retained on failure (`trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`) and land in `test-results/`.

> **Playwright UI shows "No tests"?** Check the **Projects** filter at the top of the UI — if it's pinned to `setup`, switch it to `all`.

---

## Verification

After changing the suite, confirm nothing broke:

```bash
cd apps/web-ui-e2e
bunx playwright test --list 2>&1 | tail -1     # expected: "Total: 68 tests in 7 files"
bunx tsc --noEmit -p tsconfig.json             # type-check clean
bunx playwright test --list --grep @docs       # module slice resolves
```
