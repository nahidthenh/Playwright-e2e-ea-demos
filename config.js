'use strict';

/**
 * config.js
 *
 * Central configuration for the visual regression testing pipeline.
 * All tunable settings live here — no need to touch capture/compare/report scripts.
 */
module.exports = {

  // ── Viewport ──────────────────────────────────────────────────────────────
  viewports: {
    desktop: { width: 1920, height: 1080 },
  },

  activeViewports: ['desktop'],

  // ── Source file ───────────────────────────────────────────────────────────
  urlsFile: 'urls.txt',

  // ── Output directories ────────────────────────────────────────────────────
  dirs: {
    baseline: 'screenshots/baseline',
    current:  'screenshots/current',
    diff:     'screenshots/diff',
    reports:  'reports',
  },

  // ── Diff sensitivity ──────────────────────────────────────────────────────
  // Per-pixel colour tolerance: 0 = exact match, 1 = accept any difference.
  // 0.1 catches real rendering changes while ignoring sub-pixel anti-aliasing.
  diffThreshold: 0.1,

  // A page is marked FAIL when more than this % of total pixels changed.
  failThreshold: 0.5,

  // ── Timeouts (milliseconds) ───────────────────────────────────────────────
  navigationTimeout: 60_000,  // page.goto() hard limit
  settleDelay:        2_000,  // pause after all stabilization before the screenshot
  scrollStep:           500,  // pixels scrolled per auto-scroll step
  scrollDelay:           80,  // ms between scroll steps
  maxScrollHeight:    30000,  // safety cap — stops scrolling at 30 000 px even on infinite-scroll pages

  // ── Resilience ────────────────────────────────────────────────────────────
  retries:   2,  // retries per failing page (total attempts = retries + 1)
  batchSize: 5,  // pages captured in parallel; lower if RAM is tight

  // ── Optional server-side "test mode" ─────────────────────────────────────
  // When set, this query param is appended to every URL.
  // Your WordPress theme/plugin can detect it and skip dynamic elements server-side.
  // Set to null to disable.
  testingModeParam: null, // e.g. 'visual_test=1'

  // ── CSS selectors hidden via `display:none` before capture ───────────────
  // These elements change on every page load and cause false positives.
  // Add or remove selectors as you discover new dynamic elements.
  hideSelectors: [

    // ── Exit-intent / opt-in popups ──────────────────────────────────────
    '.elementor-popup-modal',
    '[data-elementor-type="popup"]',
    '.ea-optin-popup',
    '.ea-optin-bar',
    '[class*="optin-popup"]',
    '[class*="optin-bar"]',

    // ── Cookie / GDPR banners ────────────────────────────────────────────
    '#cookie-law-info-bar',
    '#cookie-notice',
    '.cookie-notice-container',
    '.cc-window',
    '.cookieconsent',
    '[id*="cookie"]',
    '[class*="cookie-banner"]',
    '[class*="consent-banner"]',
    '[class*="gdpr"]',

    // ── Countdown timers (tick every second → guaranteed false positive) ─
    '[data-widget_type="eael-countdown.default"]',
    '[data-widget_type*="countdown"]',
    '.elementor-widget-eael-countdown',
    '.elementor-countdown-wrapper',
    '.elementor-countdown-item',
    '[class*="eael-countdown"]',
    '.eael-count-down',

    // ── Promotional / announcement bars ──────────────────────────────────
    '.promo-bar',
    '.offer-bar',
    '.sale-bar',
    '.announcement-bar',
    '.notificationx-bar',
    '.notificationx-popup',
    '.nx-notification',
    '#notificationx-container',
    '[class*="promo-bar"]',
    '[class*="sale-bar"]',

    // ── Fancy Text typewriter cursor ─────────────────────────────────────
    '.typed-cursor',
    '.eael-fancy-text-strings',
    '.elementor-widget-eael-fancy-text .typed-strings',

    // ── Live chat widgets ─────────────────────────────────────────────────
    '[aria-label="Open chat"]',
    '#intercom-container',
    '.intercom-lightweight-app',
    '.intercom-launcher',
    '#hubspot-messages-iframe-container',
    '#crisp-chatbox',
    '.drift-frame-controller',
    '#tidio-chat',
    '#fc_frame',

    // ── WordPress admin bar (logged-in state) ────────────────────────────
    '#wpadminbar',
  ],

  // ── Playwright mask selectors ─────────────────────────────────────────────
  // These elements remain in the layout but are replaced with a solid black
  // rectangle in the screenshot — useful for iframes, maps, or ad slots whose
  // content changes every load but whose presence/position matters.
  maskSelectors: [
    // '[data-widget_type="google_maps.default"]',  // uncomment to mask Google Maps

    // 360° / Sphere Photo Viewer — the panorama canvas (Photo Sphere Viewer)
    // renders at a different rotation angle on every load. Mask the whole
    // widget so the canvas never contributes pixels to the diff.
    '.elementor-widget-eael-sphere-photo-viewer',
    '[data-widget_type="eael-sphere-photo-viewer.default"]',
    '.psv-canvas',
  ],

  // ── Cookies to pre-set before loading each page ───────────────────────────
  // Lets you dismiss popups or set a "test mode" flag at the cookie level.
  cookies: [
    // { name: 'cookie_notice_accepted', value: '1', domain: 'essential-addons.com', path: '/' },
    // { name: 'ea_popup_dismissed',     value: '1', domain: 'essential-addons.com', path: '/' },
  ],
};
