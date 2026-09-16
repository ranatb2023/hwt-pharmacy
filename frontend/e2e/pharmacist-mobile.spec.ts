// Guard for hwt-pharmacist-mobile-fix-spec.md ("Retest").
// The setup project (auth.setup.ts) logs in as the pharmacist and writes
// e2e/auth-pharmacist.json before this runs. See mobile-layout.spec.ts.
import { test, expect } from '@playwright/test';

const routes = [
  '/', '/pharmacy', '/departments', '/inventory', '/vendors', '/customers',
  '/returns', '/cashflow', '/pharmacy-close', '/credit', '/stock-audit',
];

test.use({ storageState: 'e2e/auth-pharmacist.json' });

test.describe('pharmacist on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  for (const path of routes) {
    test(`nothing scrolls sideways: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main').first()).toBeVisible();

      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow.doc).toBeLessThanOrEqual(1);
      expect(overflow.main).toBeLessThanOrEqual(1);
    });
  }

  test('Sign out is on screen', async ({ page }) => {
    await page.goto('/');
    const box = await page.getByRole('button', { name: 'Sign out' }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });
});

test.describe('pharmacist on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('More menu opens and its links work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /More/ }).click();
    await page.locator('nav').getByText('Credit Accounts', { exact: true }).click();
    await expect(page).toHaveURL(/\/credit$/);
  });
});
