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
    // ── 1. Block heavy resources to avoid timeouts ─────────────────────────
    // Abort images, fonts, media and common analytics/tracking scripts.
    // This does NOT affect ARIA snapshots — elements remain in the DOM
    // (img alt text, etc. still captured); they just don't download.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();

      const blockTypes = ['image', 'media', 'font'];
      const blockDomains = [
        'google-analytics.com', 'googletagmanager.com',
        'facebook.net', 'facebook.com/tr',
        'hotjar.com', 'clarity.ms',
        'doubleclick.net', 'googlesyndication.com',
        // Block Google Maps API so map tiles/controls never load.
        // The Maps JS API renders dynamic controls (Zoom, Satellite, Markers,
        // Keyboard shortcuts, Scale) whose presence and values change per-render.
        // Blocking at the network level is the only reliable suppression because
        // the controls are injected as DOM overlays that may appear outside the
        // Elementor widget CSS scope depending on load timing.
        'maps.googleapis.com', 'maps.gstatic.com',
      ];

      if (blockTypes.includes(type)) return route.abort();
      if (blockDomains.some((d) => url.includes(d))) return route.abort();
      route.continue();
    });

    // ── 2. Navigate ────────────────────────────────────────────────────────
    await page.goto(url, {
      waitUntil: 'load',
      timeout: 60_000,
    });

    // ── 3. Dismiss cookie / GDPR banners ───────────────────────────────────
    await dismissCookieBanner(page);

    // ── 4. Wait for Elementor frontend to finish initializing ──────────────
    await waitForElementorReady(page);

    // ── 5. Hide elements that change on every load and would cause false positives ──
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
           Days/Hours/Mins/Secs tick every second — guaranteed false positives.
           Target every known EA and Elementor countdown selector including the
           widget-type data attribute (most reliable) and all class variants.
           [class*="eael-countdown"] catches .eael-countdown-wrapper, .eael-countdown,
           .eael-countdown-1234 (ID-suffixed wrapper) and any future variants. */
        [data-widget_type="eael-countdown.default"],
        [data-widget_type*="countdown"],
        .elementor-widget-eael-countdown,
        .elementor-widget-countdown,
        .elementor-countdown-wrapper,
        .elementor-countdown-item,
        [class*="eael-countdown"],
        [class*="elementor-countdown"],
        .eael-count-down {
          display: none !important;
        }

        /* ── Fancy Text (typewriter animation) ──
           The typing cursor and partially-typed text change on every render —
           guaranteed false positives. Hide the animated span only, not the
           whole widget, so surrounding headings/descriptions remain testable. */
        .eael-fancy-text-strings,
        .eael-fancy-text-prefix,
        .typed-cursor,
        .elementor-widget-eael-fancy-text .typed-strings {
          display: none !important;
        }

        /* ── Embedded videos ──
           We block the media file from downloading but the <video> element
           and its native browser controls (Play/Seek/Mute/Fullscreen) still
           appear in the ARIA tree. Hide the element and its Elementor wrappers. */
        video,
        .elementor-widget-video,
        .elementor-video-container,
        .elementor-fit-aspect-ratio,
        .eael-video-gallery-wrap,
        .eael-video-gallery,

        /* ── Custom / third-party video players (Plyr, EA Video, YouTube embeds) ──
           These wrap <video> or <iframe> with their own controls that also
           surface in the ARIA tree but are not covered by the selectors above. */
        .plyr,
        .plyr--video,
        .plyr__video-wrapper,
        [data-plyr-provider],
        .elementor-widget-ea-video,
        iframe[src*="youtube"],
        iframe[src*="youtu.be"] {
          display: none !important;
        }

        /* ── Seasonal / promotional banners ──
           "New Season, More Savings" / spring2026 promo bar loads
           inconsistently — hide by known class names and the optin URL pattern. */
        .promo-bar, .offer-bar, .sale-bar,
        .announcement-bar,
        .ea-optin-popup, .ea-optin-bar,
        .ea-spring-promo, .spring-promo-bar,
        [class*="optin-bar"], [class*="promo-bar"] {
          display: none !important;
        }

        /* ── Carousels / sliders (Swiper, Splide, Slick) ──
           Hide cloned/duplicate slides used for infinite-loop so only the
           real original slides appear in the ARIA tree.
           Suppress slide transitions so the JS reset to slide-0 is instant.
           NOTE: do NOT override transform — Swiper uses transforms to
           position slides and its ARIA module (group "X / N" labels) depends
           on those transforms being correct. */
        .swiper-slide-duplicate,
        .slick-cloned,
        .splide__slide--clone {
          display: none !important;
        }
        .swiper-wrapper,
        .slick-track,
        .splide__track,
        .splide__list {
          transition: none !important;
          animation: none !important;
        }

        /* ── Google Maps widget ──
           The Maps API injects dynamic controls (Zoom, Satellite toggle,
           Pegman, map scale, Terms link) and their values change per render.
           Hiding the entire widget gives a deterministic snapshot. */
        [data-widget_type="google_maps.default"],
        .elementor-widget-google_maps {
          display: none !important;
        }

        /* ── EA Progress Bar widget ──
           CountUp.js drives the percentage counter via requestAnimationFrame.
           Critically, addStyleTag triggers a CSS reflow which re-fires
           IntersectionObserver, restarting CountUp from 0. The rAF-stub
           approach is unreliable because it races with this IO re-trigger.
           Hiding the entire widget removes the non-deterministic values from
           the ARIA tree while preserving section headings and descriptions
           (Implement Unique Styles, Progress Bar Style 01-05 etc.) which
           are the meaningful structural signals for regression detection. */
        [data-widget_type="eael-progress-bar.default"],
        .elementor-widget-eael-progress-bar {
          display: none !important;
        }

        /* ── Live chat widgets ──
           Hide by aria-label and common vendor container IDs/classes.
           These load inconsistently and cause random failures. */
        [aria-label="Open chat"],
        #intercom-container,
        .intercom-lightweight-app,
        .intercom-launcher,
        #hubspot-messages-iframe-container,
        #crisp-chatbox,
        .drift-frame-controller,
        #tidio-chat,
        #fc_frame {
          display: none !important;
        }
      `,
    });

    // ── 6. Stop Swiper carousels and reset to slide 0 ─────────────────────
    // Swiper in loop-mode clones slides. When autoplay advances into the
    // cloned region those slides lack aria-label, so `group "X / N"` roles
    // and nav buttons disappear from the ARIA tree — causing non-deterministic
    // failures on every run even after baseline regeneration.
    // Stopping autoplay + snapping back to slide 0 (0 ms animation) gives a
    // stable, deterministic ARIA tree every time.
    await page.evaluate(() => {
      // ── Swiper carousels ──────────────────────────────────────────────────
      document.querySelectorAll('.swiper-container, .swiper').forEach((el) => {
        const swiper = el.swiper;
        if (!swiper) return;
        try {
          swiper.autoplay?.stop();
          swiper.slideTo(0, 0, false); // instant — no animation, no callbacks
        } catch (_) { /* ignore non-Swiper elements */ }
      });

      // ── Splide carousels ──────────────────────────────────────────────────
      document.querySelectorAll('.splide').forEach((el) => {
        const splide = el.splide;
        if (!splide) return;
        try {
          splide.Components?.Autoplay?.pause();
          splide.go(0); // snap to first slide
        } catch (_) { /* ignore non-Splide elements */ }
      });

      // ── CountUp.js / rAF-driven JS counters → force completion ──────────────
      // CountUp.js (used by EA Progress Bar, EA Counter, etc.) drives its
      // animation via requestAnimationFrame. It terminates when:
      //   (rAF timestamp - startTime) >= animationDuration
      // CSS animation-duration: 0s has ZERO effect on rAF-based animations.
      //
      // Fix: replace window.requestAnimationFrame with a version that immediately
      // executes the callback with a timestamp 10 s in the future.  Any CountUp
      // callback still queued in the browser's rAF queue will fire naturally on
      // the next frame; when CountUp then re-schedules via rAF, our stub runs it
      // instantly with the future timestamp → CountUp sees elapsed >> duration
      // and jumps to its final value in one step.
      // We restore the original rAF after 500 ms (snapshot is at +300 ms).
      // ── CountUp.js / rAF-driven JS counters → force completion ──────────────
      // CountUp.js terminates when: (rAF_timestamp - startTime) >= duration.
      // Strategy: stub rAF to schedule callbacks via setTimeout(cb, 0) with a
      // timestamp 10 s in the future.  setTimeout (not direct execution) is
      // critical — calling cb() directly recurses infinitely because CountUp
      // re-schedules itself inside its own callback (stack overflows before it
      // can reach the terminal condition, leaving counters stuck at 0).
      //
      // Timeline:
      //  T+0  stub installed
      //  T+16 natural rAF fires for CountUp (startTime already set); CountUp
      //       re-schedules via stub → setTimeout(0) queued
      //  T+17 setTimeout fires: CountUp runs with futureTs
      //       → elapsed >> duration → terminates at endVal (final value) ✓
      //  T+300 snapshot taken — DOM shows deterministic final value
      const _futureTs = performance.now() + 10_000;
      const _origRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = (cb) => {
        setTimeout(() => { try { cb(_futureTs); } catch (_) { /* ignore */ } }, 0);
        return 0;
      };
      // Restore original rAF after snapshot window (500 ms > 300 ms wait)
      setTimeout(() => { window.requestAnimationFrame = _origRaf; }, 500);
    });

    // Short pause so Swiper can update its ARIA attributes after slideTo
    await page.waitForTimeout(300);

    // ── 7. Capture the ARIA tree and compare against the stored snapshot ───
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
    const ariaTree = (await page.locator('body').ariaSnapshot())
      // Strip dynamic WordPress nonces so logout URLs don't cause false failures
      .replace(/[?&]_wpnonce=[a-f0-9]+/g, '')
      .replace(/([?&])_wpnonce=[a-f0-9]+&/g, '$1');
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
