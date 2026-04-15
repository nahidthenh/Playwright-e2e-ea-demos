/**
 * regression.spec.js
 *
 * DOM-based regression tests for Essential Addons demo pages.
 *
 * How it works:
 *  1. Reads all URLs from urls.txt at test collection time.
 *  2. Generates a clean test name and snapshot name from each URL.
 *  3. For each URL, navigates to the page, waits for network idle,
 *     cleans volatile DOM content (cookies, nonces, scripts), then
 *     compares the resulting HTML against a stored snapshot.
 *
 * First run  → snapshots are created (baseline).
 * Subsequent → snapshots are compared; mismatches fail the test.
 * Update     → run with --update-snapshots to refresh baselines.
 *
 * Usage:
 *   npx playwright test                          # run all
 *   npx playwright test --update-snapshots       # update baselines
 *   npx playwright test --grep "advanced-tabs"   # single widget
 *   npx playwright test --project=mobile         # mobile viewport only
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { readUrls } = require('../utils/readUrls');
const { urlToSnapshotName } = require('../utils/nameHelper');
const { serializeCleanDOM } = require('../utils/domCleaner');

// ---------------------------------------------------------------------------
// Load URL list once at module level (synchronous — fine for test collection)
// ---------------------------------------------------------------------------
const URLS_FILE = path.resolve(__dirname, '../urls.txt');
const urls = readUrls(URLS_FILE);

// ---------------------------------------------------------------------------
// Sanity-check: fail loudly if urls.txt is empty or missing
// ---------------------------------------------------------------------------
if (urls.length === 0) {
  throw new Error(`No URLs found in ${URLS_FILE}. Add at least one URL.`);
}

// ---------------------------------------------------------------------------
// Optional: filter URLs via env var URL_FILTER (substring match)
// Example: URL_FILTER=woo npx playwright test  → only WooCommerce widgets
// ---------------------------------------------------------------------------
const urlFilter = process.env.URL_FILTER ?? '';
const filteredUrls = urlFilter
  ? urls.filter((u) => u.includes(urlFilter))
  : urls;

if (filteredUrls.length === 0) {
  throw new Error(`URL_FILTER="${urlFilter}" matched 0 URLs. Check your filter string.`);
}

// ---------------------------------------------------------------------------
// Generate parametrized tests — one per URL
// ---------------------------------------------------------------------------
for (const url of filteredUrls) {
  const testName = urlToSnapshotName(url); // e.g. "elementor--advanced-tabs" (always unique)
  const snapshotName = testName;           // reuse — snapshot file matches test name 1-to-1

  test(testName, async ({ page }, testInfo) => {
    // ------------------------------------------------------------------
    // Step 1: Navigate with a generous timeout — some pages are JS-heavy
    // ------------------------------------------------------------------
    await page.goto(url, {
      // 'networkidle' waits until no network requests fire for 500ms.
      // Best choice for Elementor pages that lazy-load widget assets.
      waitUntil: 'networkidle',
      timeout: 45_000,
    });

    // ------------------------------------------------------------------
    // Step 2: Dismiss cookie / GDPR popups if they appear
    // We check for common accept buttons — if none exist, move on.
    // ------------------------------------------------------------------
    await dismissCookieBanner(page);

    // ------------------------------------------------------------------
    // Step 3: Wait for Elementor's front-end JS to finish rendering.
    // Elementor fires a custom event 'elementor/frontend/init' when ready.
    // We give it 5 s max; if it never fires the page likely isn't Elementor.
    // ------------------------------------------------------------------
    await waitForElementorReady(page);

    // ------------------------------------------------------------------
    // Step 4: Serialize a cleaned DOM snapshot.
    // The serializeCleanDOM function runs in the browser and strips
    // volatile content (scripts, nonces, cookie banners, animations).
    // ------------------------------------------------------------------
    // Convert the stored function string back to a callable function in browser
    const cleanHtml = await page.evaluate(
      new Function(`return (${serializeCleanDOM})()`) // eslint-disable-line no-new-func
    );

    // ------------------------------------------------------------------
    // Step 5: Compare against the stored snapshot.
    // The snapshot file lives at:
    //   snapshots/<project>/<testFile>/<snapshotName>.txt
    //
    // On first run Playwright writes the file (baseline).
    // On subsequent runs it diffs and fails if there's a mismatch.
    // ------------------------------------------------------------------
    expect(cleanHtml).toMatchSnapshot(`${snapshotName}.html`);
  });
}

// ---------------------------------------------------------------------------
// Helper: dismiss cookie / consent banners
// ---------------------------------------------------------------------------
async function dismissCookieBanner(page) {
  // Common accept-button selectors across cookie plugins
  const acceptSelectors = [
    // CookieYes / Cookie Notice by dFactory
    '#cookie_action_close_header',
    '.cookie_action_close_header',
    // Cookie Notice for GDPR (WebToffee)
    'button[data-cookie-action="accept"]',
    // CookiePro / OneTrust
    '#onetrust-accept-btn-handler',
    // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    // Generic fallback labels
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("Allow")',
    'button:has-text("I Accept")',
    'a:has-text("Accept")',
  ];

  for (const selector of acceptSelectors) {
    try {
      const btn = page.locator(selector).first();
      // Short timeout — don't stall if the banner isn't present
      if (await btn.isVisible({ timeout: 1_500 })) {
        await btn.click({ timeout: 3_000 });
        // Wait a moment for the banner to animate out
        await page.waitForTimeout(500);
        break; // Only need to click one button
      }
    } catch {
      // Selector not found — continue to the next one
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: wait for Elementor frontend to initialize
// ---------------------------------------------------------------------------
async function waitForElementorReady(page) {
  try {
    await page.waitForFunction(
      () =>
        typeof window.elementorFrontend !== 'undefined' &&
        window.elementorFrontend.isEditMode?.() === false,
      { timeout: 8_000 }
    );
  } catch {
    // Page may not use Elementor (or init event already fired) — proceed anyway
  }

  // Small stabilization pause: lets lazy-loaded images and fonts settle
  // 600 ms is negligible on 150 URLs run in parallel
  await page.waitForTimeout(600);
}
