import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

/** Creates a dashboard via the UI, opens it, and adds one widget via the builder. Returns its id. */
async function createDashboardWithWidget(page: Page, name: string): Promise<string> {
  await page.goto('/dashboards');
  await page.getByRole('button', { name: /new dashboard/i }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();

  await page.getByText(name).click();
  await expect(page).toHaveURL(/\/dashboards\/.+/);

  await page.getByRole('button', { name: /edit/i }).click();
  await page
    .getByRole('button', { name: /add (your first )?widget/i })
    .first()
    .click();

  await page.getByRole('heading', { name: 'Add widget' }).waitFor();
  await page.getByText('Select source').click();
  await page.getByRole('option', { name: 'Sessions & messages' }).click();
  await page.getByText('Select metric').click();
  await page.getByRole('option', { name: 'Session count' }).click();
  await page.getByRole('button', { name: /save widget/i }).click();

  await expect(page.locator('.react-grid-item')).toBeVisible();
  return page.url().split('/dashboards/')[1];
}

test.describe('Custom dashboards', { tag: [TAG.dashboards, TAG.regression] }, () => {
  test('registry endpoint returns the two v1 sources', async ({ request }) => {
    const res = await request.get('/api/dashboards/registry');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const keys = body.sources.map((s: { key: string }) => s.key);
    expect(keys).toContain('sessions');
    expect(keys).toContain('session_analytics');
  });

  test('query endpoint rejects an unknown source', async ({ request }) => {
    const res = await request.post('/api/dashboards/query', {
      data: {
        source: 'secrets',
        metric: { key: 'count' },
        dateRange: { preset: 'last_30d' },
        filters: [],
        vizType: 'kpi',
      },
    });
    expect(res.status()).toBe(422);
  });

  test('create dashboard, add a widget, and see it render', async ({ page }) => {
    await createDashboardWithWidget(page, `E2E Dashboard ${Date.now()}`);
    await expect(page.getByText('Untitled widget')).toBeVisible();
  });

  // No rename affordance exists on the dashboard detail page (apps/web-ui/app/(dashboard)/dashboards/[id]/page.tsx
  // — the "Edit" button there toggles widget-editing mode, not the dashboard name) or on the list page
  // (apps/web-ui/app/(dashboard)/dashboards/page.tsx). The PUT route exists, so this verifies the route directly.
  test('edit dashboard name persists via the API', async ({ page, request }) => {
    const dashboardId = await createDashboardWithWidget(page, `Edit Me ${Date.now()}`);
    const editedName = `Edited Name ${Date.now()}`;

    const res = await request.put(`/api/dashboards/${dashboardId}`, {
      data: { name: editedName },
    });
    expect(res.ok()).toBeTruthy();
    const { dashboard } = await res.json();
    expect(dashboard.name).toBe(editedName);

    const getRes = await request.get(`/api/dashboards/${dashboardId}`);
    expect((await getRes.json()).dashboard.name).toBe(editedName);

    await page.goto('/dashboards');
    await expect(page.getByText(editedName)).toBeVisible();
  });

  // No delete affordance exists in the UI either (same two files as above). The DELETE route exists,
  // so this verifies the route directly and that the list page no longer shows it after reload.
  test('delete dashboard via the API removes it from the list', async ({ page, request }) => {
    const name = `Delete Me ${Date.now()}`;
    const dashboardId = await createDashboardWithWidget(page, name);

    const res = await request.delete(`/api/dashboards/${dashboardId}`);
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`/api/dashboards/${dashboardId}`);
    expect(getRes.status()).toBe(404);

    await page.goto('/dashboards');
    await expect(page.getByText(name)).not.toBeVisible();
  });

  // WidgetBuilder (components/dashboards/widget-builder.tsx) accepts initialSpec/initialTitle props
  // built for editing, but DashboardPage never wires up an edit trigger — there is no "edit widget" UI.
  // The PUT route exists, so this verifies the route directly.
  test('edit widget via the API persists the new title', async ({ page, request }) => {
    const dashboardId = await createDashboardWithWidget(page, `Widget Edit ${Date.now()}`);
    const { dashboard } = await (await request.get(`/api/dashboards/${dashboardId}`)).json();
    const widgetId = dashboard.widgets[0].id;

    const res = await request.put(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
      data: { title: 'Renamed Widget' },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`/api/dashboards/${dashboardId}`);
    const updated = (await getRes.json()).dashboard.widgets[0];
    expect(updated.title).toBe('Renamed Widget');
  });

  // Real UI affordance: WidgetCard (components/dashboards/widget-card.tsx) renders an "X" icon button
  // when editable=true, which is the dashboard's edit mode toggled by the "Edit" button.
  test('delete widget removes it from the grid', async ({ page }) => {
    await createDashboardWithWidget(page, `Widget Delete ${Date.now()}`);

    await page.locator('.react-grid-item').getByRole('button').click();

    await expect(page.locator('.react-grid-item')).not.toBeVisible();
    await expect(page.getByText('No widgets yet.')).toBeVisible();
  });

  // react-grid-layout drag/resize simulation is flaky in Playwright — verify the layout-save route
  // directly, then confirm the UI still renders correctly on reload.
  test('save layout via API and see it persisted on reload', async ({ page, request }) => {
    const dashboardId = await createDashboardWithWidget(page, `Layout Test ${Date.now()}`);
    const { dashboard } = await (await request.get(`/api/dashboards/${dashboardId}`)).json();
    const widget = dashboard.widgets[0];

    const res = await request.put(`/api/dashboards/${dashboardId}/layout`, {
      data: { layouts: [{ id: widget.id, layout: { x: 2, y: 0, w: 4, h: 4 } }] },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await request.get(`/api/dashboards/${dashboardId}`);
    const updated = (await getRes.json()).dashboard.widgets[0];
    expect(updated.layout).toEqual({ x: 2, y: 0, w: 4, h: 4 });

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${dashboardId}`));
    await expect(page.locator('.react-grid-item')).toBeVisible();
  });
});
