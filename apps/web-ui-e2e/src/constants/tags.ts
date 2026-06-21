/**
 * Tag taxonomy for the E2E suite. Two orthogonal axes:
 *   - module: exactly one per spec (run/skip a whole product area)
 *   - type/priority: one or more per test
 *
 * Filter with Playwright's `--grep` / `--grep-invert`, e.g.
 *   bunx playwright test --grep @docs            # run the docs module
 *   bunx playwright test --grep-invert @sso      # skip the sso module
 *   bunx playwright test --grep @smoke           # priority slice across modules
 */
export const TAG = {
  // module axis
  auth: '@auth',
  sso: '@sso',
  marketing: '@marketing',
  docs: '@docs',
  navigation: '@navigation',
  inferenceApi: '@inference-api',
  dashboards: '@dashboards',

  // type / priority axis
  smoke: '@smoke',
  regression: '@regression',
  api: '@api',
  critical: '@critical',
  anon: '@anon',
  authRequired: '@auth-required',
} as const;

export type Tag = (typeof TAG)[keyof typeof TAG];
