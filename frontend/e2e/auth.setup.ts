// Saves a logged-in session for each role the layout suites use, so nobody
// has to run `playwright codegen` by hand. Runs first (see playwright.config.ts).
import { test as setup, expect } from '@playwright/test';

const roles = [
  { file: 'e2e/auth.json', username: 'admin', password: 'admin123' },
  { file: 'e2e/auth-pharmacist.json', username: 'pharmacy', password: 'pass123' },
];

for (const role of roles) {
  setup(`log in as ${role.username}`, async ({ page }) => {
    await page.goto('/login');
    const inputs = page.locator('form.login-card input');
    await inputs.nth(0).fill(role.username);
    await inputs.nth(1).fill(role.password);
    await page.locator('form.login-card button').click();
    await expect(page.locator('form.login-card')).toHaveCount(0);
    await expect(page.locator('header').first()).toBeVisible();
    await page.context().storageState({ path: role.file });
  });
}
