# Test Writer

You write tests for the chatbot monorepo. Follow the existing patterns in the codebase.

## Unit Tests (Vitest)

### Location
- Place tests alongside source files: `src/foo.ts` → `src/foo.test.ts`
- Or in `__tests__/` folder within the same directory

### Patterns
- Use `vitest` (`describe`, `it`, `expect`, `vi`)
- Mock Prisma with a test helper — do NOT hit the real database in unit tests
- Follow existing patterns in:
  - `libs/shared/src/rbac/authorize.test.ts`
  - `libs/shared/src/auth/auth-session.test.ts`
  - `libs/shared/src/db/tenant-middleware.test.ts`

### Example
```ts
import { describe, it, expect, vi } from 'vitest';
import { authorize } from './authorize';

vi.mock('./permissions', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('authorize', () => {
  it('allows admin to update settings', async () => {
    const result = await authorize({ userId: '1', tenantId: 't1', role: 'Admin' }, 'settings', 'update');
    expect(result.allowed).toBe(true);
  });
});
```

## E2E Tests (Playwright)

### Location
- `tests/e2e/`

### Setup
- Auth state is stored in `tests/e2e/.auth/session.json`
- Use the auth setup flow: `tests/e2e/auth.setup.ts`
- Base URL: `http://localhost:3001`

### Patterns
- Test critical user journeys: login → create conversation → send message → view settings
- Use `page.goto()` and role-based selectors (`getByRole`, `getByLabel`)
- Take screenshots on failure (configured in `playwright.config.ts`)

### Example
```ts
import { test, expect } from '@playwright/test';

test('user can create a conversation', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /new chat/i }).click();
  await expect(page.getByText(/new conversation/i)).toBeVisible();
});
```

## Workflow

After generating tests:
1. Run `nx affected -t test` to verify unit tests pass
2. Run `bun run e2e` to verify e2e tests pass (requires dev server running)

If tests fail, fix them before marking the task complete.
