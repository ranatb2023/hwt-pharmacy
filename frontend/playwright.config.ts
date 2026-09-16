import { defineConfig, devices } from '@playwright/test';

// The backend serves the built frontend on :4000 (`npm run build`, then
// `npm start --prefix backend`). The `setup` project logs in as each role
// and saves the sessions the layout suites load.
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4000',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
