// Guard for the mobile fix spec (hwt-pharmacy-mobile-fix-spec.md, "Retest").
//
// With the backend serving the built frontend on :4000 (`npm run build`, then
// `npm start --prefix backend`): `npm run test:e2e`. The setup project
// (auth.setup.ts) logs in and writes e2e/auth.json first.
import { test, expect } from '@playwright/test';

const routes = [
  '/', '/pharmacy', '/pharmacy-close', '/returns', '/inventory', '/stock-audit', '/vendors',
  '/admin/catalogue', '/customers', '/credit', '/dialysis', '/cashflow', '/departments',
  '/reports', '/admin/subsidy', '/admin/audit', '/admin/users', '/admin/roles',
  '/admin/employees', '/admin/settings', '/admin/sync', '/amend', '/admin/dialysis',
];

test.use({ storageState: 'e2e/auth.json' });

test.describe('phone 360', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  for (const path of routes) {
    test(`fits: ${path}`, async ({ page }) => {
      await page.goto(path);
      const main = page.locator('main').first();
      await expect(main).toBeVisible();

      const sideways = await main.evaluate((m) => m.scrollWidth - m.clientWidth);
      expect(sideways).toBeLessThanOrEqual(1);

      // drawer is closed by default
      const asideRight = await page.locator('#app-sidebar').evaluate((a) => a.getBoundingClientRect().right);
      expect(asideRight).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('leaving Roles keeps the app alive', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.locator('#app-sidebar a[href="/"]').first().click();
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('POS cart shows medicine names', async ({ page }) => {
    await page.goto('/pharmacy');
    const width = await page.locator('main table thead th').nth(1)
      .evaluate((th) => th.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(120);
  });
});
