# Claw Studio E2E Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the two user-visible journeys from D1–D3 with Playwright specs — edit a soul file and restore a revision; create a scheduled task and see its run land — which today is impossible because the e2e harness cannot reach Mission Control at all.

**Architecture:** Mission Control runs on port 3010 with its **own** NextAuth Credentials login and its own `NEXTAUTH_SECRET`; the existing Playwright config has a single `baseURL` on port 3005 (web-ui) and one `chromium` project. This plan adds a second Playwright project with its own baseURL and its own session-minting setup, then writes the specs.

**Tech Stack:** Playwright, `@t3-oss/env-core`, `jose`/`next-auth/jwt` for token minting, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-30-claw-soul-and-cron-design.md` (§11)

**Depends on:** D1 (`/agent` page) and D3 (`/cron` page). Run this **last**.

## Global Constraints

- **Do not weaken the existing e2e harness.** The `chromium` project targeting web-ui must keep working
  exactly as it does. Adding a project must not change the default `bun run e2e` behaviour for existing
  specs beyond including the new ones.
- **Known-red baseline:** `bun run e2e:smoke` has ~17 pre-existing failures in the marketing and docs
  specs, unrelated to this work. Do not attempt to fix them here; do not treat them as caused by this
  plan. Record the count before starting so you can compare.
- **Never declare `test.use({ storageState: { cookies: [], origins: [] } })` inline** — the project's
  documented rule. Unauthenticated tests take the `anonPage` fixture.
- **Specs import `{ test, expect }` from the fixtures barrel**, not from `@playwright/test`.
- **Never read or print `.env*` files.** `MISSION_CONTROL_NEXTAUTH_SECRET` is consumed through the typed
  env object only.
- **Env access goes through `src/config/env.ts`** — it is documented as the only place `process.env` is
  read in the e2e project.
- **Tags:** every new spec carries `@claw-studio` (the tag already exists at
  `src/constants/tags.ts:22`) plus a type tag from the existing taxonomy.
- **Code style:** no comments unless the *why* is non-obvious.

**Verified facts about the target app — build against these, do not guess:**
- `apps/mission-control/middleware.ts`: *"Mission Control authenticates with its own Studio ID +
  password… it does not trust web-ui's session."* It guards pages only; the matcher excludes `/api`,
  `/login`, and Next internals.
- MC's JWT carries `{ studioId, tenantId, clawId, studioRecordId }`; the session callback exposes them
  as `session.studio`.
- MC session strategy is `jwt` with `maxAge: 24 * 60 * 60`.
- The existing web-ui minting helper lives at `apps/web-ui-e2e/src/helpers/` (`mintSessionToken`) — read
  it and mirror its approach rather than inventing a second one.

---

### Task 1: Wire Playwright for Mission Control

**Files:**
- Modify: `apps/web-ui-e2e/src/config/env.ts`
- Modify: `apps/web-ui-e2e/playwright.config.ts`
- Create: `apps/web-ui-e2e/src/setup/mission-control.setup.ts`
- Create: `apps/web-ui-e2e/src/helpers/mint-studio-token.ts`
- Modify: `apps/web-ui-e2e/src/constants/routes.ts`

**Interfaces:**
- Produces:
  - `env.MISSION_CONTROL_URL` (default `http://localhost:3010`), `env.MISSION_CONTROL_NEXTAUTH_SECRET`
  - `function mintStudioToken(claims: { studioId: string; tenantId: string; clawId: string; studioRecordId?: string }): Promise<string>`
  - a `mission-control-setup` Playwright project writing `src/.auth/mission-control.json`
  - a `mission-control` project with `baseURL: env.MISSION_CONTROL_URL`, `dependencies: ['mission-control-setup']`, `testMatch: /modules\/mission-control\/.*\.spec\.ts/`
  - `ROUTES.missionControl = { dashboard: '/dashboard', agent: '/agent', cron: '/cron', runs: '/runs' }`

- [ ] **Step 1: Add the env vars**

In `apps/web-ui-e2e/src/config/env.ts`, add to the existing schema:

```ts
    MISSION_CONTROL_URL: z.string().url().default('http://localhost:3010'),
    MISSION_CONTROL_NEXTAUTH_SECRET: z.string().min(1).optional(),
```

Optional because the existing web-ui specs must still run when it is unset — Task 2 skips the MC
project in that case rather than failing the whole suite.

- [ ] **Step 2: Write the token minter**

Create `apps/web-ui-e2e/src/helpers/mint-studio-token.ts`. Read
`apps/web-ui-e2e/src/helpers/` first and mirror how the existing `mintSessionToken` signs its JWT
(same library, same encryption mode — NextAuth v4 uses an encrypted JWE by default, so the existing
helper is the authority on the exact call).

```ts
import { env } from '../config/env';

export interface StudioClaims {
  studioId: string;
  tenantId: string;
  clawId: string;
  studioRecordId?: string;
}

export async function mintStudioToken(claims: StudioClaims): Promise<string> {
  const secret = env.MISSION_CONTROL_NEXTAUTH_SECRET;
  if (!secret) throw new Error('MISSION_CONTROL_NEXTAUTH_SECRET is required to mint a Mission Control session');
  // Mirror the existing web-ui mintSessionToken exactly — same encode call, same
  // maxAge — only the claims and the secret differ.
  // …
  return token;
}
```

Use `maxAge: 24 * 60 * 60` to match MC's `session.maxAge`.

- [ ] **Step 3: Write the setup project**

Create `apps/web-ui-e2e/src/setup/mission-control.setup.ts`, mirroring `setup/auth.setup.ts`:

```ts
import { test as setup } from '@playwright/test';
import path from 'node:path';
import { env } from '../config/env';
import { mintStudioToken } from '../helpers/mint-studio-token';

const AUTH_FILE = path.join(__dirname, '..', '.auth', 'mission-control.json');

setup('mint the Mission Control session cookie', async ({ }) => {
  const token = await mintStudioToken({
    studioId: env.E2E_STUDIO_ID ?? 'claw_e2e',
    tenantId: env.E2E_TENANT_ID ?? 'e2e-tenant',
    clawId: env.E2E_CLAW_ID ?? 'e2e-claw',
  });
  const url = new URL(env.MISSION_CONTROL_URL);
  // …write storageState with the next-auth.session-token cookie scoped to url.hostname
});
```

Reuse whatever tenant/studio identifiers `auth.setup.ts` already establishes rather than adding new env
vars, if it exposes them. The cookie name must match what MC's NextAuth uses
(`next-auth.session-token` over http, `__Secure-` prefixed over https) — read `auth.setup.ts` for the
established convention.

- [ ] **Step 4: Add the two projects**

In `playwright.config.ts`, add to the `projects` array (leaving `setup` and `chromium` untouched):

```ts
    {
      name: 'mission-control-setup',
      testMatch: /setup\/mission-control\.setup\.ts/,
    },
    {
      name: 'mission-control',
      testMatch: /modules\/mission-control\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.MISSION_CONTROL_URL,
        storageState: path.join(__dirname, 'src', '.auth', 'mission-control.json'),
      },
      dependencies: ['mission-control-setup'],
    },
```

Also add `MISSION_CONTROL_URL` to the existing `chromium` project's exclusion — i.e. confirm the
existing `chromium` project has a `testMatch` or `testIgnore` that keeps it from picking up
`modules/mission-control/`. If it currently matches all specs, add
`testIgnore: /modules\/mission-control\//` to it. **Verify this**, otherwise the MC specs will also run
against port 3005 and fail confusingly.

The existing `webServer` runs `bun run dev:all`, which already starts Mission Control — confirm by
reading the root `package.json` `dev:all` script. If it does not include mission-control, add a second
`webServer` entry for it rather than changing `dev:all`.

- [ ] **Step 5: Add the routes and verify the harness boots**

Add to `src/constants/routes.ts`:

```ts
  missionControl: {
    dashboard: '/dashboard',
    agent: '/agent',
    cron: '/cron',
    runs: '/runs',
  },
```

Verify with a throwaway smoke spec at `src/modules/mission-control/boots.spec.ts`:

```ts
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ROUTES } from '../../constants/routes';

test(`loads the Mission Dashboard when authenticated ${TAG.clawStudio} ${TAG.smoke}`, async ({ page }) => {
  await page.goto(ROUTES.missionControl.dashboard);
  await expect(page.getByRole('heading', { name: 'Mission Dashboard' })).toBeVisible();
});
```

Run:
```bash
cd apps/web-ui-e2e && bunx playwright test --project=mission-control
```
Expected: PASS — proving the minted cookie satisfies MC's middleware and the baseURL is right. If it
redirects to `/login`, the cookie name or the secret is wrong; fix that before continuing, because
every later spec depends on it.

Then confirm no regression:
```bash
cd ../.. && bun run e2e:smoke
```
Expected: the same ~17 pre-existing marketing/docs failures as your recorded baseline, and no new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui-e2e/src/config/env.ts apps/web-ui-e2e/playwright.config.ts apps/web-ui-e2e/src/setup/mission-control.setup.ts apps/web-ui-e2e/src/helpers/mint-studio-token.ts apps/web-ui-e2e/src/constants/routes.ts apps/web-ui-e2e/src/modules/mission-control
git commit -m "test(e2e): wire a Playwright project for Mission Control"
```

---

### Task 2: Workspace files journey

**Files:**
- Create: `apps/web-ui-e2e/src/modules/mission-control/workspace-files.spec.ts`
- Modify: `apps/mission-control/components/agent/file-editor.tsx` (add test ids)
- Modify: `apps/mission-control/components/agent/revision-history-dialog.tsx` (add test ids)

**Interfaces:**
- Consumes: Task 1's `mission-control` project; D1's `/agent` page
- Produces: the spec §11 journey — *edit SOUL → save → verify persisted + a revision exists → restore*

Add `data-testid` attributes rather than relying on text selectors for the editor internals, matching
how the existing `provision.spec.ts` uses `getByTestId('mission-control')`.

- [ ] **Step 1: Add the test ids**

In `file-editor.tsx`: `data-testid="file-editor-textarea"` on the `Textarea`,
`data-testid="file-editor-save"` on Save, `data-testid="file-editor-reset"` on Reset,
`data-testid="file-editor-history"` on History, and `data-testid="file-editor-meta"` on the
character-count/version line.

In `revision-history-dialog.tsx`: `data-testid="revision-row"` on each `TableRow` and
`data-testid="revision-restore"` on each Restore button.

Keep the accessible roles and labels already there — the test ids are additive.

- [ ] **Step 2: Write the spec**

Create `apps/web-ui-e2e/src/modules/mission-control/workspace-files.spec.ts`:

```ts
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ROUTES } from '../../constants/routes';

const MARKER = `e2e-soul-${Date.now()}`;

test.describe(`workspace files ${TAG.clawStudio}`, () => {
  test(`edits and persists SOUL, then restores the previous revision ${TAG.regression}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.agent);

    await page.getByRole('tab', { name: 'Soul' }).click();
    const editor = page.getByTestId('file-editor-textarea');
    await expect(editor).toBeVisible();

    const original = await editor.inputValue();
    expect(original.length).toBeGreaterThan(0);

    await editor.fill(`${original}\n${MARKER}`);
    await page.getByTestId('file-editor-save').click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Persistence, not just optimistic UI.
    await page.reload();
    await page.getByRole('tab', { name: 'Soul' }).click();
    await expect(page.getByTestId('file-editor-textarea')).toHaveValue(new RegExp(MARKER));

    // A revision exists for the edit.
    await page.getByTestId('file-editor-history').click();
    const rows = page.getByTestId('revision-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(2);

    // Restoring the previous version drops the marker.
    await rows.nth(1).getByTestId('revision-restore').click();
    await expect(page.getByText('Restored')).toBeVisible();
    await expect(page.getByTestId('file-editor-textarea')).not.toHaveValue(new RegExp(MARKER));
  });

  test(`shows all six workspace file tabs ${TAG.smoke}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.agent);
    for (const name of ['Identity', 'Soul', 'Agents', 'User', 'Tools', 'Heartbeat']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
  });

  test(`blocks a save that exceeds the character cap ${TAG.regression}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.agent);
    await page.getByRole('tab', { name: 'Identity' }).click();
    await page.getByTestId('file-editor-textarea').fill('x'.repeat(600)); // cap is 500
    await expect(page.getByTestId('file-editor-save')).toBeDisabled();
  });

  test(`redirects an unauthenticated visitor to the Mission Control login ${TAG.anon}`, async ({ anonPage }) => {
    await anonPage.goto(ROUTES.missionControl.agent);
    await expect(anonPage).toHaveURL(/\/login/);
  });
});
```

The restore test asserts the *reloaded* value, not the in-memory one — that is the difference between
testing persistence and testing optimistic UI.

- [ ] **Step 3: Run it**

Run: `cd apps/web-ui-e2e && bunx playwright test --project=mission-control workspace-files`
Expected: PASS (4 tests).

If the `anonPage` fixture carries web-ui's storage state rather than no state, check
`fixtures/base.ts` — `anonPage` is documented as the unauthenticated fixture, so it should work
unchanged against the MC baseURL.

- [ ] **Step 4: Delete the throwaway smoke spec**

Remove `src/modules/mission-control/boots.spec.ts` from Task 1 — the dashboard assertion is now
redundant with real coverage. Keep the module folder.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui-e2e/src/modules/mission-control apps/mission-control/components/agent
git commit -m "test(e2e): cover the workspace files edit and restore journey"
```

---

### Task 3: Scheduled task journey

**Files:**
- Create: `apps/web-ui-e2e/src/modules/mission-control/scheduled-tasks.spec.ts`
- Modify: `apps/mission-control/components/cron/scheduled-tasks-client.tsx` (add test ids)
- Modify: `apps/mission-control/components/cron/scheduled-task-dialog.tsx` (add test ids)

**Interfaces:**
- Consumes: Task 1's project; D3's `/cron` page
- Produces: the spec §11 journey — *create a scheduled task → run now → run appears in `/runs` with `source: scheduled`*

- [ ] **Step 1: Add the test ids**

In `scheduled-tasks-client.tsx`: `data-testid="new-scheduled-task"` on the create button,
`data-testid="task-row"` on each table row, `data-testid="task-run-now"` and
`data-testid="task-enabled-switch"` on the row controls.

In `scheduled-task-dialog.tsx`: `data-testid="task-name"`, `data-testid="task-prompt"`,
`data-testid="task-schedule-type"`, `data-testid="task-cron-preset"`, `data-testid="task-timezone"`,
`data-testid="task-approval-mode"`, `data-testid="task-submit"`, and
`data-testid="cron-human-readable"` on the `cronstrue` preview line.

- [ ] **Step 2: Write the spec**

Create `apps/web-ui-e2e/src/modules/mission-control/scheduled-tasks.spec.ts`:

```ts
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ROUTES } from '../../constants/routes';

const NAME = `E2E daily check ${Date.now()}`;

test.describe(`scheduled tasks ${TAG.clawStudio}`, () => {
  test(`creates a task, runs it now, and the run appears in Runs ${TAG.regression}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.cron);
    await page.getByTestId('new-scheduled-task').click();

    await page.getByTestId('task-name').fill(NAME);
    await page.getByTestId('task-prompt').fill('Report the current time and say hello. Nothing else.');
    await page.getByTestId('task-submit').click();

    await expect(page.getByText('Scheduled task created')).toBeVisible();
    const row = page.getByTestId('task-row').filter({ hasText: NAME });
    await expect(row).toBeVisible();

    await row.getByTestId('task-run-now').click();
    await expect(page.getByText(/run started|running now/i)).toBeVisible();

    await page.goto(ROUTES.missionControl.runs);
    const runRow = page.getByTestId('run-row').filter({ hasText: NAME }).first();
    await expect(runRow).toBeVisible({ timeout: 30_000 });

    // Assert a TERMINAL state, not mere appearance: a run that is created and then
    // never executed would still "appear", which is exactly the sweeper bug this
    // spec exists to catch. Either outcome is a pass — the e2e tenant may have no
    // LLM provider, so 'failed' is legitimate here. Do not narrow this to
    // 'completed'; that would make the spec environment-dependent and flaky.
    await expect(runRow).toContainText(/completed|failed/i, { timeout: 90_000 });
  });

  test(`shows a human-readable cadence and rejects a too-frequent cron ${TAG.regression}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.cron);
    await page.getByTestId('new-scheduled-task').click();
    await page.getByTestId('task-name').fill('E2E cadence check');
    await page.getByTestId('task-prompt').fill('Say hello.');

    await page.getByTestId('task-cron-preset').click();
    await page.getByRole('option', { name: 'Custom' }).click();
    await page.getByPlaceholder('e.g. 0 9 * * 1-5').fill('0 10 * * *');
    await expect(page.getByTestId('cron-human-readable')).toContainText('10:00');

    await page.getByPlaceholder('e.g. 0 9 * * 1-5').fill('* * * * *');
    await page.getByTestId('task-submit').click();
    await expect(page.getByText(/at least/i)).toBeVisible();
  });

  test(`pauses a task from the list ${TAG.regression}`, async ({ page }) => {
    await page.goto(ROUTES.missionControl.cron);
    const row = page.getByTestId('task-row').filter({ hasText: NAME });
    await row.getByTestId('task-enabled-switch').click();
    await expect(row).toContainText(/paused/i);
  });

  test(`redirects an unauthenticated visitor to the login ${TAG.anon}`, async ({ anonPage }) => {
    await anonPage.goto(ROUTES.missionControl.cron);
    await expect(anonPage).toHaveURL(/\/login/);
  });
});
```

The run-now assertion needs a generous timeout because the run genuinely executes a graph. If the
tenant has no LLM provider configured in the e2e environment, the run will fail rather than complete —
which is fine: the spec asserts the run *appears*, not that it succeeded. Note that in a comment so
nobody "fixes" it into flakiness.

The pause test depends on the first test's task existing, so these run serially within the file.
Add `test.describe.configure({ mode: 'serial' })` at the top of the describe block to make that
explicit rather than incidental.

- [ ] **Step 3: Run it**

Run: `cd apps/web-ui-e2e && bunx playwright test --project=mission-control scheduled-tasks`
Expected: PASS (4 tests).

- [ ] **Step 4: Add an Nx target**

In `apps/web-ui-e2e/project.json`, add an `e2e:mission-control` target mirroring the existing
`e2e:<module>` targets, running `bunx playwright test --project=mission-control`. Add it to the root
`CLAUDE.md` command list beside the other `e2e:*` commands.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui-e2e apps/mission-control/components/cron CLAUDE.md
git commit -m "test(e2e): cover the scheduled task create and run journey"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run the new project in full**

Run: `cd apps/web-ui-e2e && bunx playwright test --project=mission-control`
Expected: all 8 specs PASS.

- [ ] **Step 2: Confirm no regression in the existing suite**

Run: `bun run e2e:smoke`
Expected: exactly the pre-existing marketing/docs failures you recorded before Task 1 — no new ones,
and no MC specs accidentally running against port 3005.

- [ ] **Step 3: Confirm the unit suites are still green**

```bash
cd libs/claw-studio && bunx vitest run
cd ../.. && bun run test
```
Expected: no new failures versus the 443 baseline plus D1–D3 additions.

- [ ] **Step 4: Document the harness change**

Add a short note to the root `CLAUDE.md` e2e architecture section: Mission Control specs live in
`modules/mission-control/`, run under the `mission-control` Playwright project against
`MISSION_CONTROL_URL` (default 3010), and authenticate via a separately minted studio session because
**MC does not trust web-ui's session** — it has its own NextAuth Credentials login and its own
`NEXTAUTH_SECRET`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the Mission Control e2e project"
```

---

## Verification checklist

- [ ] `bunx playwright test --project=mission-control` — 8 specs pass
- [ ] `bun run e2e:smoke` — only the pre-existing marketing/docs failures, no new ones
- [ ] The existing `chromium` project does **not** pick up `modules/mission-control/` specs
- [ ] `bun run test` — no new unit failures
- [ ] Editing SOUL persists across a reload and creates a revision
- [ ] Restoring a revision reverts the content
- [ ] The identity char cap disables Save
- [ ] Creating a task, running it now, and finding the run in `/runs` all work
- [ ] `* * * * *` is rejected with the cadence-floor message
- [ ] An unauthenticated visit to `/agent` and `/cron` redirects to MC's own `/login`
- [ ] No spec declares `test.use({ storageState: { cookies: [], origins: [] } })` inline
- [ ] No `.env` file was read or printed at any point
