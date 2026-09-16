import { defineConfig } from '@playwright/test';

// The backend serves the built frontend on :4000 (`npm run build`, then
// `npm start --prefix backend`). See e2e/mobile-layout.spec.ts for the
// one-time login capture.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4000',
  },
});
