/**
 * regression.spec.js
 *
 * Aria-snapshot regression tests for Essential Addons demo pages.
 *
 * How it works:
 *  1. Reads all URLs from urls.txt at test-collection time.
 *  2. For each URL: navigates, waits for Elementor to finish rendering,
 *     dismisses cookie banners, then captures the ARIA tree of the main
 *     content area and compares it against a stored .txt snapshot.
 *
 * Why aria snapshot (not full HTML):
 *  - Captures semantic structure: headings, buttons, links, regions, images.
 *  - Ignores CSS classes, nonces, asset hashes, inline styles — no false positives.
 *  - Diffs are human-readable: you immediately see *what* changed, not noise.
 *
 * First run  → snapshot .txt files are written as the baseline.
 * Subsequent → aria tree is compared; any structural change fails the test.
 * Update     → npx playwright test --update-snapshots
 *
 * Usage:
 *   npx playwright test                              # run all
 *   npx playwright test --update-snapshots          # regenerate baselines
 *   npx playwright test --grep "advanced-tabs"      # single widget
 *   npx playwright test --project=mobile            # mobile viewport only
 *   URL_FILTER=woo npx playwright test              # only WooCommerce widgets
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { readUrls } = require('../utils/readUrls');
const { urlToSnapshotName } = require('../utils/nameHelper');

// ---------------------------------------------------------------------------
// Load URL list once at module level (synchronous — fine for test collection)
// ---------------------------------------------------------------------------
const URLS_FILE = path.resolve(__dirname, '../urls.txt');
const urls = readUrls(URLS_FILE);

if (urls.length === 0) {
  throw new Error(`No URLs found in ${URLS_FILE}. Add at least one URL.`);
}

// ---------------------------------------------------------------------------
// Optional: filter URLs via env var URL_FILTER (substring match)
// Example: URL_FILTER=woo npx playwright test  →  only WooCommerce widgets
// ---------------------------------------------------------------------------
const urlFilter = process.env.URL_FILTER ?? '';
const filteredUrls = urlFilter
  ? urls.filter((u) => u.includes(urlFilter))
  : urls;

if (filteredUrls.length === 0) {
  throw new Error(`URL_FILTER="${urlFilter}" matched 0 URLs. Check your filter string.`);
}

// ---------------------------------------------------------------------------
// Parametrized tests — one per URL
// ---------------------------------------------------------------------------
for (const url of filteredUrls) {
  // Unique name e.g. "elementor--advanced-tabs" or "360-degree-photo-viewer"
  const testName = urlToSnapshotName(url);

  test(testName, async ({ page }) => {
    // ── 1. Navigate ────────────────────────────────────────────────────────
    // 'load' fires when HTML + render-blocking resources are done.
    // Much faster than 'networkidle' which stalls on pages with social
    // embeds, WooCommerce polling, or persistent background requests.
    // Elementor readiness is handled separately by waitForElementorReady().
    await page.goto(url, {
      waitUntil: 'load',
      timeout: 60_000,
    });

    // ── 2. Dismiss cookie / GDPR banners ───────────────────────────────────
    await dismissCookieBanner(page);

    // ── 3. Wait for Elementor frontend to finish initializing ──────────────
    await waitForElementorReady(page);

    // ── 4. Hide elements that change on every load and would cause false positives ──
    await page.addStyleTag({
      content: `
        /* ── Site chrome (header / footer / WP admin bar) ── */
        header, footer, #wpadminbar,
        #site-header, #site-footer,
        .site-header, .site-footer,
        nav[aria-label*="site"], nav[aria-label*="main"] {
          display: none !important;
        }

        /* ── NotificationX sales / conversion popups ──
           Use EXACT class names — avoid [class*="notificationx"] which
           would also match body.has-notificationx and hide the whole page. */
        .notificationx-bar,
        .notificationx-popup,
        .nx-notification,
        #notificationx-container {
          display: none !important;
        }

        /* ── Countdown timers ──
           Days/Hours/Mins/Secs tick every second — guaranteed false positives. */
        .elementor-countdown-wrapper,
        .eael-countdown {
          display: none !important;
        }

        /* ── Seasonal / promotional banners ──
           Use exact class names from the EA site to avoid hiding body
           or other wrapper elements that share a substring. */
        .promo-bar, .offer-bar, .sale-bar,
        .announcement-bar,
        .ea-optin-popup, .ea-optin-bar {
          display: none !important;
        }
      `,
    });

    // ── 5. Capture the ARIA tree and compare against the stored snapshot ───
    // page.locator('body').ariaSnapshot() returns a YAML-like string of the
    // full accessibility tree — roles, names, headings, buttons, links, text.
    // CSS classes, nonces, asset hashes and inline styles are invisible to it.
    //
    // We then store/compare that string with toMatchSnapshot() which is the
    // standard, well-tested file-based snapshot API in Playwright.
    //
    // Snapshot file: snapshots/<project>/tests/regression.spec.js/<testName>.txt
    // First run (--update-snapshots) → file is written as the baseline
    // Next runs                      → string is diffed; any structural
    //                                  change fails the test
    const ariaTree = await page.locator('body').ariaSnapshot();
    expect(ariaTree).toMatchSnapshot(`${testName}.txt`);
  });
}

// ---------------------------------------------------------------------------
// Helper: dismiss cookie / consent banners
// Tries common selectors across popular WP cookie plugins.
// Short timeouts ensure we don't stall on pages without a banner.
// ---------------------------------------------------------------------------
async function dismissCookieBanner(page) {
  const acceptSelectors = [
    '#cookie_action_close_header',                         // Cookie Notice by dFactory
    '.cookie_action_close_header',
    'button[data-cookie-action="accept"]',                 // WebToffee GDPR
    '#onetrust-accept-btn-handler',                        // OneTrust / CookiePro
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Allow")',
    'button:has-text("I Accept")',
    'a:has-text("Accept")',
  ];

  for (const selector of acceptSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1_500 })) {
        await btn.click({ timeout: 3_000 });
        await page.waitForTimeout(400); // let banner animate out
        break;
      }
    } catch {
      // Not found — try next selector
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: wait for Elementor frontend JS to finish initializing
// Elementor sets window.elementorFrontend when ready; we poll for it.
// Falls through gracefully on non-Elementor pages.
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
    // Not an Elementor page, or already initialized — continue
  }

  // Short stabilization pause for lazy-loaded images / fonts to settle
  await page.waitForTimeout(600);
}
