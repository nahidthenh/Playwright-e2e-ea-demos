/**
 * playwright.smoke.config.ts
 *
 * Config for the demo-site smoke test (smoke/). Fully separate from
 * playwright.config.js (the aria visual-regression suite) — run with:
 *
 *   npx playwright test --config=playwright.smoke.config.ts
 *
 * Tunables (SMOKE_CONCURRENCY, SMOKE_RETRIES, timeouts…) live in
 * smoke/ignore-config.ts and are env-overridable.
 */

import { defineConfig, devices } from '@playwright/test';
import { CONCURRENCY, RETRIES, NAV_TIMEOUT_MS, TEST_TIMEOUT_MS } from './smoke/ignore-config';

export default defineConfig({
  testDir: './smoke',
  testMatch: 'smoke.spec.ts',

  fullyParallel: true,
  // parallel pages — keep modest (default 8) to avoid hammering the live server
  workers: CONCURRENCY,
  // retry once so a single slow load / transient network blip doesn't fail the run
  retries: RETRIES,
  timeout: TEST_TIMEOUT_MS,

  forbidOnly: !!process.env.CI,

  globalSetup: './smoke/global-setup',
  globalTeardown: './smoke/global-teardown',

  reporter: [
    ['list'],
    ['html', { outputFolder: 'smoke-report', open: 'never' }],
  ],

  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    headless: true,
    navigationTimeout: NAV_TIMEOUT_MS,
    actionTimeout: 30_000,
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'only-on-failure',
    // demo pages are public — no auth state needed
  },

  outputDir: 'smoke-results/test-artifacts',
});
