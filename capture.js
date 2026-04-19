#!/usr/bin/env node
'use strict';

/**
 * capture.js
 *
 * Takes full-page screenshots of every URL in urls.txt and saves them to:
 *   screenshots/baseline/<viewport>/   (before plugin update)
 *   screenshots/current/<viewport>/    (after plugin update)
 *
 * Usage:
 *   node capture.js --mode=baseline
 *   node capture.js --mode=current
 *   node capture.js --mode=baseline --viewport=desktop
 *   node capture.js --mode=baseline --viewport=desktop,tablet,mobile
 */

const path             = require('path');
const fs               = require('fs');
const { chromium }     = require('@playwright/test');
const config           = require('./config');
const { readUrls }     = require('./utils/readUrls');
const { urlToSnapshotName } = require('./utils/nameHelper');

// ── Tiny helpers ──────────────────────────────────────────────────────────────
const sleep     = ms => new Promise(r => setTimeout(r, ms));
const ensureDir = d  => fs.mkdirSync(d, { recursive: true });

function parseArg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

// ── Validate CLI args ─────────────────────────────────────────────────────────
const mode = parseArg('mode');
if (!mode || !['baseline', 'current'].includes(mode)) {
  console.error('Error: --mode=baseline or --mode=current is required.\n');
  console.error('  node capture.js --mode=baseline');
  console.error('  node capture.js --mode=current');
  process.exit(1);
}

const activeViewports = config.activeViewports; // always ['desktop']

// ── Load URLs ─────────────────────────────────────────────────────────────────
let urls;
try {
  urls = readUrls(path.resolve(config.urlsFile));
} catch (err) {
  console.error(`Failed to read URLs from "${config.urlsFile}": ${err.message}`);
  process.exit(1);
}

if (!urls.length) {
  console.error(`No URLs found in ${config.urlsFile}. Add at least one URL.`);
  process.exit(1);
}

// --limit=N  →  only process the first N URLs (useful for smoke-testing)
const limitArg = parseArg('limit');
if (limitArg) {
  const n = parseInt(limitArg, 10);
  if (!isNaN(n) && n > 0) urls = urls.slice(0, n);
}

const totalScreenshots = urls.length * activeViewports.length;
let completedCount = 0;

console.log(`
┌─ EA Visual Regression ── Capture ─────────────────────────────
│  mode      : ${mode}
│  URLs      : ${urls.length}
│  viewports : ${activeViewports.join(', ')}
│  total     : ${totalScreenshots} screenshots
│  batch     : ${config.batchSize} concurrent pages
│  retries   : ${config.retries} per page
└───────────────────────────────────────────────────────────────
`);

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',  // prevents /dev/shm OOM crashes in Docker/CI
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
  });

  const summary = { success: [], failed: [] };

  for (const viewport of activeViewports) {
    const { width, height } = config.viewports[viewport];
    const outDir = path.join(config.dirs[mode], viewport);
    ensureDir(outDir);

    console.log(`── ${viewport} (${width}×${height}) ${'─'.repeat(45 - viewport.length)}`);

    // Process in batches to keep memory under control
    for (let i = 0; i < urls.length; i += config.batchSize) {
      const batch = urls.slice(i, i + config.batchSize);

      // All pages in the batch run concurrently, each in its own browser context
      await Promise.all(
        batch.map((url, batchOffset) =>
          captureWithRetry(
            browser, url,
            i + batchOffset,   // global index in urls array
            viewport, width, height,
            outDir, summary
          )
        )
      );
    }
  }

  await browser.close();

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`
──────────────────────────────────────────────────────────────
  total   : ${totalScreenshots}
  ✓ done  : ${summary.success.length}
  ✗ failed: ${summary.failed.length}
`);

  if (summary.failed.length) {
    console.log('Failed pages:');
    summary.failed.forEach(f => console.log(`  [${f.viewport}] ${f.url}`));
    console.log('');
  }

  // Persist a log so you can audit which pages ran
  const logPath = path.join(config.dirs[mode], 'capture-log.json');
  ensureDir(config.dirs[mode]);
  fs.writeFileSync(logPath, JSON.stringify({
    mode,
    timestamp: new Date().toISOString(),
    viewports: activeViewports,
    success:   summary.success,
    failed:    summary.failed,
  }, null, 2));

  console.log(`Log saved → ${logPath}\n`);

  if (summary.failed.length) process.exit(1);
}

// ── Capture one URL with up to `config.retries` retries ──────────────────────
async function captureWithRetry(browser, url, urlIndex, viewport, width, height, outDir, summary) {
  const name     = urlToSnapshotName(url);
  const filename = `${name}.png`;
  const outPath  = path.join(outDir, filename);

  // Optionally append the server-side test-mode param
  let targetUrl = url;
  if (config.testingModeParam) {
    targetUrl += (url.includes('?') ? '&' : '?') + config.testingModeParam;
  }

  let lastError;

  for (let attempt = 0; attempt <= config.retries; attempt++) {
    // Each attempt uses a fresh, isolated browser context (its own cookie jar,
    // cache, and localStorage) so failed cookies / JS state never carry over.
    const context = await browser.newContext({
      viewport: { width, height },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,  // useful for self-hosted staging environments
    });

    try {
      // Pre-set cookies (e.g. to dismiss popups before the first navigation)
      if (config.cookies.length) {
        const domain = new URL(url).hostname;
        await context.addCookies(
          config.cookies.map(c => ({ ...c, domain: c.domain || domain }))
        );
      }

      const page = await context.newPage();
      page.setDefaultTimeout(config.navigationTimeout);
      page.setDefaultNavigationTimeout(config.navigationTimeout);

      // 'domcontentloaded' fires as soon as the HTML is parsed — it does NOT
      // wait for images, fonts, or third-party scripts (social feeds, live
      // chat, analytics) which can stall 'load' or 'networkidle' indefinitely.
      // Our stabilizePage() — waitForElementor + autoScroll + settleDelay —
      // gives the page plenty of time to fully render before the screenshot.
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeout,
      });

      // Apply all stabilization techniques before screenshotting
      await stabilizePage(page);

      // Build Playwright mask locators (empty array is fine — no masks applied)
      const maskLocators = config.maskSelectors
        .filter(Boolean)
        .map(sel => page.locator(sel));

      await page.screenshot({
        path:     outPath,
        fullPage: true,
        type:     'png',
        ...(maskLocators.length ? { mask: maskLocators } : {}),
      });

      completedCount++;
      console.log(`  [${pad(completedCount, totalScreenshots)}] ✓  ${viewport}/${filename}`);
      summary.success.push({ url, name, viewport });

      await context.close();
      return; // ← success: exit the retry loop

    } catch (err) {
      lastError = err;
      await context.close().catch(() => {}); // best-effort cleanup

      if (attempt < config.retries) {
        const wait = 1500 * (attempt + 1); // 1.5s, 3s backoff
        console.warn(`  [${pad(urlIndex + 1, urls.length)}] ↺  retry ${attempt + 1}/${config.retries} in ${wait / 1000}s — ${url}`);
        await sleep(wait);
      }
    }
  }

  // All attempts exhausted
  completedCount++;
  const shortMsg = (lastError?.message ?? 'Unknown error').split('\n')[0];
  console.error(`  [${pad(completedCount, totalScreenshots)}] ✗  FAILED  ${url}`);
  console.error(`        ${shortMsg}`);
  summary.failed.push({ url, name, viewport, error: shortMsg });
}

// ── Page stabilization ────────────────────────────────────────────────────────
// Applied before every screenshot. Order matters:
//   CSS injection first (stops new animations from starting),
//   then Elementor wait (ensures all widget JS has run),
//   then scroll (triggers IntersectionObserver / lazy load),
//   then carousel/counter JS fixes,
//   then final settle delay.
async function stabilizePage(page) {
  // 1 ── Inject CSS: kill animations, hide all configured dynamic elements
  await page.addStyleTag({ content: buildStabilizationCSS() });

  // 2 ── Wait for Elementor frontend JS to finish initialising
  await waitForElementor(page);

  // 3 ── Auto-scroll top→bottom to trigger lazy images and IntersectionObserver widgets
  await autoScroll(page);

  // 4 ── Snap back to top (screenshot starts from y=0)
  await page.evaluate(() => window.scrollTo(0, 0));

  // 5 ── Stop JS-driven carousels and fast-forward rAF counters
  await page.evaluate(() => {

    // ── Swiper (v8 / v9) ──────────────────────────────────────────────────
    // Loop-mode clones slides and advances into them during autoplay —
    // clones lack aria-labels so the visual layout shifts unpredictably.
    // slideTo(0, 0, false) snaps to the real first slide with no animation.
    document.querySelectorAll('.swiper-container, .swiper').forEach(el => {
      const swiper = el.swiper;
      if (!swiper) return;
      try {
        swiper.autoplay?.stop();
        swiper.slideTo(0, 0, false);
      } catch (_) {}
    });

    // ── Splide ────────────────────────────────────────────────────────────
    document.querySelectorAll('.splide').forEach(el => {
      const splide = el.splide;
      if (!splide) return;
      try {
        splide.Components?.Autoplay?.pause();
        splide.go(0);
      } catch (_) {}
    });

    // ── Slick ─────────────────────────────────────────────────────────────
    if (typeof window.$ === 'function') {
      try {
        window.$('.slick-initialized').slick('slickGoTo', 0, true);
      } catch (_) {}
    }

    // ── CountUp.js / rAF-driven counters ──────────────────────────────────
    // CountUp terminates when (rAF timestamp − startTime) >= animationDuration.
    // We stub requestAnimationFrame to schedule callbacks via setTimeout(0)
    // with a timestamp 10 s in the future, forcing every counter to jump to
    // its final value in a single step. Using setTimeout (not a direct call)
    // prevents infinite recursion because CountUp re-schedules itself inside
    // its own callback.
    const futureTs = performance.now() + 10_000;
    const origRaf  = window.requestAnimationFrame;
    window.requestAnimationFrame = cb => {
      setTimeout(() => { try { cb(futureTs); } catch (_) {} }, 0);
      return 0;
    };
    // Restore after 1 s (screenshot is taken after settleDelay, which is 2 s)
    setTimeout(() => { window.requestAnimationFrame = origRaf; }, 1000);
  });

  // 6 ── Final settle: lets rAF stubs fire, DOM updates propagate, fonts render
  await sleep(config.settleDelay);
}

// ── Scroll the page top→bottom to trigger lazy loading ───────────────────────
async function autoScroll(page) {
  // We pass step and delay into page.evaluate as a serialisable parameter
  // so config values don't need to be accessible inside the browser context.
  await page.evaluate(
    ({ step, delay }) =>
      new Promise(resolve => {
        let scrolled = 0;
        const id = setInterval(() => {
          window.scrollBy(0, step);
          scrolled += step;
          // document.body.scrollHeight updates as new content is lazy-loaded,
          // so we re-read it on every tick rather than caching it upfront.
          if (scrolled >= document.body.scrollHeight) {
            clearInterval(id);
            resolve();
          }
        }, delay);
      }),
    { step: config.scrollStep, delay: config.scrollDelay }
  );
}

// ── Wait for Elementor frontend JS to finish initialising ─────────────────────
async function waitForElementor(page) {
  try {
    await page.waitForFunction(
      () => typeof window.elementorFrontend !== 'undefined',
      { timeout: 8_000 }
    );
  } catch (_) {
    // Not an Elementor page, or init already complete — continue
  }
  // Short pause for widget-level JS (counters, carousels) to run after init
  await sleep(400);
}

// ── Build the CSS block injected on every page ────────────────────────────────
function buildStabilizationCSS() {
  // Join all hide selectors into one ruleset
  const hideList = config.hideSelectors
    .filter(Boolean)
    .join(',\n  ');

  return `
/* ── Kill all CSS animations and transitions ──────────────────────────────── */
*, *::before, *::after {
  animation-duration:        0s   !important;
  animation-delay:           0s   !important;
  animation-iteration-count: 1    !important;
  transition-duration:       0s   !important;
  transition-delay:          0s   !important;
  scroll-behavior:           auto !important;
}

/* ── Hide dynamic / false-positive elements ───────────────────────────────── */
${hideList} {
  display:        none  !important;
  visibility:     hidden !important;
  pointer-events: none  !important;
}

/* ── Freeze carousel wrappers at their current translated position ─────────── */
.swiper-wrapper,
.slick-track,
.splide__track,
.splide__list {
  transition: none !important;
  animation:  none !important;
}

/* ── Hide duplicate "clone" slides used in loop-mode infinite scroll ────────── */
/* (clones have no proper aria-labels and shift the visual layout) */
.swiper-slide-duplicate,
.slick-cloned,
.splide__slide--clone {
  display: none !important;
}
`;
}

// ── Utility: pad a counter like "  5/119" for aligned console output ─────────
function pad(n, total) {
  const w = String(total).length;
  return `${String(n).padStart(w)}/${total}`;
}

// ── Run ───────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
