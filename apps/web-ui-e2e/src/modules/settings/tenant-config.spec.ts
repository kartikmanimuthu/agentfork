import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Tenant Config API', { tag: [TAG.api, TAG.smoke] }, () => {
  test('GET rejects unauthenticated', async ({ anonPage }) => {
    // next-auth middleware intercepts unauthenticated requests to /api/* before
    // the route handler runs, returning a 307 redirect to the sign-in page
    // rather than a 401 from the route itself — assert the redirect directly.
    const res = await anonPage.request.get('/api/tenant-config?key=webSearchConfig', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/api/auth/signin');
  });

  test('GET returns null for an unset key (authenticated)', async ({ page }) => {
    const res = await page.request.get('/api/tenant-config?key=__e2e_nonexistent_key__');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.value).toBeNull();
  });
});

test.describe('Agent Versions API', { tag: [TAG.api, TAG.smoke] }, () => {
  test('GET rejects unauthenticated', async ({ anonPage }) => {
    // Same next-auth middleware redirect as the tenant-config route above.
    const res = await anonPage.request.get('/api/agents/versions', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/api/auth/signin');
  });

  test('GET returns a versions array (authenticated)', async ({ page }) => {
    const res = await page.request.get('/api/agents/versions');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.versions)).toBe(true);
  });
});
