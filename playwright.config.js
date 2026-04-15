// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  // Directory where test files are located
  testDir: './tests',

  // Run all tests in parallel across files and workers
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests once on CI to reduce flakiness from network hiccups
  retries: process.env.CI ? 1 : 0,

  // Use all available CPU cores on CI, 4 locally for stable parallel runs
  workers: process.env.CI ? '100%' : 4,

  // Reporter: HTML for local review, GitHub Actions annotation on CI
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['html', { outputFolder: 'playwright-report', open: 'on-failure' }]],

  // Shared settings applied to every test project
  use: {
    // Base URL not set because we use absolute URLs from urls.txt
    // Fail fast: don't wait longer than 30s for a page action
    actionTimeout: 30_000,

    // Capture a trace only when retrying a failed test — good for debugging without bloating CI
    trace: 'on-first-retry',

    // No video or screenshots — we rely on DOM snapshots
    video: 'off',
    screenshot: 'off',
  },

  // Snapshot comparison settings
  // 'lax' trims leading/trailing whitespace differences — reduces noise in HTML snapshots
  snapshotPathTemplate: 'snapshots/{projectName}/{testFilePath}/{arg}{ext}',

  // Per-project viewport configuration — desktop and mobile
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Run headless for speed
        headless: true,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        // Playwright's Pixel 5 preset sets viewport + user-agent
        headless: true,
      },
    },
  ],

  // Global timeout per test (150 URLs × ~20s each on cold run still fits in CI limit)
  timeout: 60_000,

  // Where Playwright stores test artifacts
  outputDir: 'test-results',
});
