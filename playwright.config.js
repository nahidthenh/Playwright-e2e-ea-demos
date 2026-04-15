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

  // ── Reporters ──────────────────────────────────────────────────────────────
  // CI:    GitHub annotations + HTML report + Slack notification
  // Local: list output + HTML report (no Slack)
  reporter: process.env.CI
    ? [
        ['blob'],
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        [
          './node_modules/playwright-slack-report/dist/src/SlackReporter.js',
          {
            // SLACK_CHANNEL_ID is set as a GitHub Actions secret
            channels: [process.env.SLACK_CHANNEL_ID],

            // Send to Slack whether tests pass or fail
            sendResults: 'always',

            // Show all failures in Slack (0 = unlimited)
            maxNumberOfFailuresToShow: 0,

            // Custom metadata block shown at the top of the Slack message
            meta: [
              {
                key: ':essential-addons-logo: Demo Regression - Test Results',
                // PAGES_URL is the GitHub Pages / artifact URL set in the workflow
                value: `🖥️ <${process.env.PAGES_URL}|View Results!>`,
              },
            ],
          },
        ],
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ],

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
