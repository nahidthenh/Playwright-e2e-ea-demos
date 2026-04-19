'use strict';

/**
 * regression.spec.js
 *
 * Converts the pixel-comparison results (reports/results.json written by
 * compare.js) into Playwright test cases so playwright-slack-report can post
 * a per-page pass/fail summary to Slack.
 *
 * No browser is launched — these tests only read the JSON file.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const RESULTS_PATH = path.resolve(__dirname, '../reports/results.json');

if (!fs.existsSync(RESULTS_PATH)) {
  throw new Error(`results.json not found at ${RESULTS_PATH}. Run compare.js first.`);
}

const { results } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

for (const result of results) {
  test(result.name, async () => {
    const detail = result.diffPercent != null
      ? `${result.diffPercent.toFixed(3)}% pixels changed`
      : result.error ?? result.note ?? result.status;

    expect(result.status, detail).toBe('pass');
  });
}
