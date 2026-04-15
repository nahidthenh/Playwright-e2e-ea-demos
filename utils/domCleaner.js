/**
 * domCleaner.js
 *
 * Runs inside the browser context via page.evaluate() to strip out
 * elements and attributes that change on every page load (timestamps,
 * nonces, social counters, cookie banners, etc.).
 *
 * Keeping this logic isolated makes it easy to tune without touching
 * the main test file.
 */

/**
 * List of CSS selectors to fully REMOVE from the DOM before snapshotting.
 * These elements are either dynamic, irrelevant, or break determinism.
 */
const REMOVE_SELECTORS = [
  // Cookie / GDPR consent banners
  '#cookie-law-info-bar',
  '#cookie-notice',
  '.cookie-notice-container',
  '.cc-window',
  '.cookieconsent',
  '[class*="cookie-banner"]',
  '[class*="consent-banner"]',
  '[id*="cookie"]',
  '[id*="gdpr"]',

  // Admin / WordPress toolbar (logged-in state)
  '#wpadminbar',

  // Chat widgets (Intercom, Crisp, etc.)
  '#intercom-container',
  '[class*="intercom"]',
  '.crisp-client',
  '[id*="chat-widget"]',

  // Social proof / live counters that change constantly
  '[class*="live-counter"]',
  '[class*="visitor-count"]',

  // Popup overlays
  '.elementor-popup-modal',
  '[data-elementor-type="popup"]',

  // Generic "back to top" — position can shift snapshot diffs
  '#back-to-top',
  '.back-to-top',

  // Notification bars that may or may not be dismissed
  '.notice-bar',
  '[class*="announcement-bar"]',
];

/**
 * Attribute names to strip from ALL elements.
 * These contain nonces, session tokens, or build hashes that differ per request.
 */
const STRIP_ATTRIBUTES = [
  'data-nonce',
  'nonce',
  'data-_token',
  'data-token',
];

/**
 * Inject a <style> tag that disables CSS transitions and animations.
 * This prevents mid-animation states from being captured in the DOM snapshot.
 */
const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

/**
 * Serializes the cleaned DOM to an HTML string.
 * Called inside page.evaluate() — has access to browser globals.
 *
 * @returns {string} Cleaned outer HTML of <body>.
 */
function serializeCleanDOM() {
  // --- 1. Disable animations globally ---
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }
  `;
  document.head.appendChild(style);

  // --- 2. Remove dynamic / irrelevant elements ---
  const removeSelectors = [
    '#cookie-law-info-bar', '#cookie-notice', '.cookie-notice-container',
    '.cc-window', '.cookieconsent', '[class*="cookie-banner"]',
    '[class*="consent-banner"]', '[id*="cookie"]', '[id*="gdpr"]',
    '#wpadminbar', '#intercom-container', '[class*="intercom"]',
    '.crisp-client', '[id*="chat-widget"]', '[class*="live-counter"]',
    '[class*="visitor-count"]', '.elementor-popup-modal',
    '[data-elementor-type="popup"]', '#back-to-top', '.back-to-top',
    '.notice-bar', '[class*="announcement-bar"]',
    // WP scripts/styles injected by plugins that vary by session
    'script[src*="nonce"]', 'link[href*="ver="]',
  ];

  removeSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => el.remove());
  });

  // --- 3. Strip volatile attributes from all elements ---
  const stripAttrs = ['data-nonce', 'nonce', 'data-_token', 'data-token'];
  document.querySelectorAll('*').forEach((el) => {
    stripAttrs.forEach((attr) => el.removeAttribute(attr));

    // Remove inline style properties that contain pixel-perfect positions
    // (can shift between deploys without visual meaning)
    // Keep style attribute but strip 'transition' and 'animation' values
    if (el.style) {
      el.style.transition = '';
      el.style.animation = '';
    }
  });

  // --- 4. Normalize script tags: remove all inline scripts (they contain
  //        nonces, timestamps, dynamic JSON that is not visual content) ---
  document.querySelectorAll('script').forEach((s) => s.remove());

  // --- 5. Remove WordPress <link rel="preload"> tags (contain ver= hashes) ---
  document.querySelectorAll('link[rel="preload"], link[as="script"]').forEach((l) => l.remove());

  // --- 6. Strip query-string `ver=` params from stylesheet hrefs ---
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (href) {
      link.setAttribute('href', href.replace(/[?&]ver=[^&]*/g, ''));
    }
  });

  // Return the cleaned body HTML
  return document.body ? document.body.outerHTML : document.documentElement.outerHTML;
}

module.exports = { serializeCleanDOM: serializeCleanDOM.toString(), DISABLE_ANIMATIONS_CSS, REMOVE_SELECTORS, STRIP_ATTRIBUTES };
