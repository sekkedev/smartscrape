import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-only Playwright config. Assumes the dev server is already running
 * (start with `npm run dev` from the repo root). The API is reachable via
 * the Vite proxy at :5173/api → :3000.
 *
 * Run with: npm run test:e2e --workspace client
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1, // single worker so the worker-scoped session fixture is truly shared
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*\.mobile\.spec\.ts$/,
    },
    {
      name: 'mobile',
      // Pixel 5 is Chromium-based, so we don't need the WebKit engine. Gives us
      // the same 375px-ish width profile without forcing `npx playwright install webkit`.
      use: { ...devices['Pixel 5'] },
      testMatch: /.*\.mobile\.spec\.ts$/,
    },
  ],
});
