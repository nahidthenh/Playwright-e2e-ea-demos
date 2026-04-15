// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  // Directory where test files are located
  testDir: './tests',

  // Run all tests in parallel across files and workers
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests once on CI to reduce flakiness from transient network issues
  retries: process.env.CI ? 1 : 0,

  // Use all available CPU cores on CI, 4 locally for stable parallel runs
  workers: process.env.CI ? '100%' : 4,

  // Reporter: HTML for local review, GitHub Actions annotation on CI
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['html', { outputFolder: 'playwright-report', open: 'on-failure' }]],

  // Shared settings applied to every project
  use: {
    actionTimeout: 30_000,

    // Trace on first retry only — useful for debugging CI failures without bloating artifacts
    trace: 'on-first-retry',

    // No video or screenshots — aria snapshots are our regression signal
    video: 'off',
    screenshot: 'off',
  },

  // Aria snapshot files are stored under snapshots/<projectName>/
  // The {arg} placeholder is the name passed to toMatchAriaSnapshot({ name: '...' })
  snapshotPathTemplate: 'snapshots/{projectName}/{testFilePath}/{arg}{ext}',

  // Per-project viewport configuration
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: true,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'], // sets viewport (393×851) + mobile user-agent
        headless: true,
      },
    },
  ],

  // Per-test timeout — generous enough for slow Elementor pages
  timeout: 60_000,

  // Artifacts (traces, etc.) go here; excluded from git via .gitignore
  outputDir: 'test-results',
});
