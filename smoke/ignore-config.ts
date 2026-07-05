/**
 * ignore-config.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CAMPAIGN / THIRD-PARTY IGNORE LAYER — edit THIS file each campaign.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * essential-addons.com permanently runs marketing campaigns (exit-intent
 * popups, countdown timers, seasonal banners, analytics pixels). Those are
 * EXPECTED and must never fail the smoke test. Everything the test suite
 * deliberately ignores or downgrades to a warning is declared here, in one
 * place, so the team can update it per campaign without touching test logic.
 *
 * Rule of thumb:
 *  - New seasonal popup/banner appears        → add its selector to CAMPAIGN_SELECTORS
 *  - New marketing pixel/script starts erroring → add a regex to CONSOLE_IGNORE_PATTERNS
 *  - New tracking domain shows failed requests  → add it to THIRD_PARTY_IGNORE_HOSTS
 *  - First-party campaign asset 404s (e.g. an exit-intent image) and you want
 *    it as a warning instead of a failure       → add a regex to FIRST_PARTY_WARN_ONLY_PATTERNS
 */

// ─── Site identity ───────────────────────────────────────────────────────────

/** Base URL of the demo site under test. Override with SMOKE_BASE_URL. */
export const BASE_URL = process.env.SMOKE_BASE_URL || 'https://essential-addons.com';

/**
 * Requests to these domains (and their subdomains) are FIRST-PARTY:
 * a 4xx/5xx or network failure on them FAILS the build
 * (unless matched by FIRST_PARTY_WARN_ONLY_PATTERNS below).
 * Everything else is third-party → failures are downgraded to warnings.
 */
export const FIRST_PARTY_DOMAINS = ['essential-addons.com', 'wpdeveloper.com'];

// ─── 1. Campaign container selectors (CSS denylist) ─────────────────────────
// Elements matched by these selectors (or nested inside them) are excluded
// from widget-presence / empty-container assertions. Countdown values, popup
// copy and banner images inside them change every load / season — expected.

export const CAMPAIGN_SELECTORS: string[] = [
  // ── Exit-intent / opt-in popups (e.g. "Wait!" popup → /summer2026-exit-intent)
  '.elementor-popup-modal',
  '[data-elementor-type="popup"]',
  '.ea-optin-popup',
  '.ea-optin-bar',
  '[class*="optin-popup"]',
  '[class*="optin-bar"]',
  '[class*="exit-intent"]',

  // ── Promo / announcement / notification bars (copy rotates by campaign)
  '.promo-bar',
  '.offer-bar',
  '.sale-bar',
  '.announcement-bar',
  '[class*="promo-bar"]',
  '[class*="sale-bar"]',
  // NotificationX FOMO bars/popups. CAUTION: don't use a broad
  // [class*="notificationx"] here — the WP <body> itself carries a
  // notificationx-* class, which would exclude the entire page.
  // (checks.ts also guards against html/body matches, but keep selectors tight.)
  '.notificationx-bar',
  '.notificationx-popup',
  '.nx-notification',
  '#notificationx-container',
  '.nx-bar',

  // ── Countdown timers in campaign sections (Days/Hours/Mins/Secs tick every
  //    second — never assert on their content). NOTE: the /countdown/ demo
  //    page itself still gets its widget-PRESENCE check; only content inside
  //    these containers is skipped for emptiness checks.
  '.eael-count-down',
  '.elementor-countdown-wrapper',

  // ── Cookie / GDPR banners
  '#cookie-law-info-bar',
  '#cookie-notice',
  '.cookie-notice-container',
  '.cc-window',
  '.cookieconsent',
  '[class*="cookie-banner"]',
  '[class*="consent-banner"]',
  '[class*="gdpr"]',

  // ── Live-chat widgets
  '#intercom-container',
  '.intercom-lightweight-app',
  '#hubspot-messages-iframe-container',
  '#crisp-chatbox',
  '#tidio-chat',
  '#fc_frame',

  // ── WP admin bar (in case a logged-in cookie sneaks into CI)
  '#wpadminbar',
];

// ─── 2. Network-failure classification ──────────────────────────────────────

/**
 * Third-party hosts whose failed requests are pure marketing/analytics noise.
 * ANY third-party failure is already only a warning; hosts listed here are
 * silently ignored (not even a warning) to keep reports readable.
 * Matched as substring of the request hostname.
 */
export const THIRD_PARTY_IGNORE_HOSTS: string[] = [
  'facebook.com', 'facebook.net', 'connect.facebook.net',   // FB Pixel
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  'gstatic.com', 'google.com/ads', 'google.com/pagead',
  'tiktok.com', 'analytics.tiktok.com',                     // TikTok pixel
  'twitter.com', 'ads-twitter.com', 't.co', 'x.com',        // X/Twitter pixel
  'linkedin.com', 'ads.linkedin.com', 'px.ads.linkedin.com',
  'bing.com', 'clarity.ms',                                 // MS Clarity / UET
  'hotjar.com', 'hotjar.io',
  'fullstory.com',
  'hubspot.com', 'hs-scripts.com', 'hs-analytics.net', 'hsforms.com',
  'intercom.io', 'intercomcdn.com',
  'crisp.chat',
  'tidio.co',
  'youtube.com', 'ytimg.com',                               // embedded videos
  'vimeo.com',
  'notificationx.com',                                      // FOMO popups (wpdeveloper marketing)
  'sentry.io',
];

/**
 * FIRST-PARTY request URLs matching any of these regexes are downgraded from
 * FAIL → WARNING. Use for campaign assets that live on essential-addons.com
 * but belong to marketing, not the plugin demos (e.g. seasonal exit-intent
 * images under /wp-content/uploads/<year>/ or campaign landing pages).
 */
export const FIRST_PARTY_WARN_ONLY_PATTERNS: RegExp[] = [
  /exit-intent/i,                       // e.g. /summer2026-exit-intent
  /(summer|winter|spring|fall|halloween|black-?friday|cyber-?monday|holiday)\d{4}/i,
  /[?&]utm_/i,                          // any UTM-tagged campaign request
  /\/wp-content\/uploads\/\d{4}\/\d{2}\/.*(campaign|promo|offer|deal|sale|banner)/i,
  // BetterDocs REST endpoints 403 for anonymous visitors on /docs/* pages
  // (rest_cookie_invalid_nonce) — pre-existing docs behaviour, not a release blocker
  /\/wp-json\/betterdocs\//i,
  /admin-ajax\.php\?action=rest-nonce/i,
];

// ─── 3. Console / JS-error ignore list (regexes) ─────────────────────────────

/**
 * console.error messages matching any regex here are downgraded to warnings.
 * Third-party script noise also gets auto-downgraded when the message's
 * source URL is not first-party — these regexes catch the rest (inline
 * loaders, generic browser noise, ad blockers on local runs, …).
 */
export const CONSOLE_IGNORE_PATTERNS: RegExp[] = [
  // resource-load console messages duplicate the network listener's findings,
  // which carry better detail and their own first-/third-party classification
  /^Failed to load resource/i,
  // local connectivity loss on the machine running the test (see NETWORK_ERROR_IGNORE)
  /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_IO_SUSPENDED/i,
  // BetterDocs anonymous-visitor nonce failures on /docs/* pages
  /rest_cookie_invalid_nonce|betterdocs/i,
  /fbevents|facebook|fbq/i,                        // FB Pixel loader noise
  /gtag|googletagmanager|google.?analytics/i,
  /tiktok/i,
  /twq|twitter/i,
  /clarity/i,
  /hotjar|hj\(/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,                   // ad blocker (local runs)
  /net::ERR_BLOCKED_BY_RESPONSE/i,                 // embeds blocked by X-Frame-Options
  /Third-party cookie/i,                           // Chrome 3P-cookie deprecation notices
  /favicon\.ico/i,
  /Mixed Content: The page .* was loaded over HTTPS, but requested an insecure (image|favicon)/i,
  /\[Deprecation\]/i,                              // browser API deprecation notices
  /preloaded using link preload but not used/i,    // perf hint, not an error
  /Failed to load resource: the server responded with a status of 4\d\d.*(facebook|tiktok|linkedin|twitter|doubleclick)/i,
];

/**
 * Uncaught page exceptions (page.on('pageerror')) whose message OR stack
 * matches any regex here are downgraded to warnings. Exceptions whose stack
 * points at a third-party host are auto-downgraded regardless.
 */
export const PAGEERROR_IGNORE_PATTERNS: RegExp[] = [
  /fbevents|googletagmanager|tiktok|clarity|hotjar/i,
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i, // benign browser noise
];

// ─── 4. Discovery exclusions ─────────────────────────────────────────────────

/**
 * Slugs linked from the Elements Panel that are NOT widget demos (footer
 * links to docs/support/etc.). They are still crawled — a 404 on them is
 * worth knowing — but you can remove them from the crawl entirely by adding
 * them to SKIP_SLUGS instead.
 */
export const SKIP_SLUGS: string[] = [
  // The changelog page legitimately contains PHP-error strings in its release
  // notes ("Fixed: Fatal error: …"), which would false-positive the PHP scan.
  'changelog',
  // 'docs',            // uncomment to stop crawling the docs landing page
];

/**
 * Chromium network error codes that are CLIENT-side artifacts, never a site
 * problem — dropped entirely from findings.
 *  - ERR_ABORTED: cancelled prefetch / navigation away
 *  - ERR_NETWORK_IO_SUSPENDED: the machine running the test went to sleep
 *  - ERR_NETWORK_CHANGED / ERR_INTERNET_DISCONNECTED: local connectivity loss
 *    (a down SITE surfaces as HTTP errors or ERR_CONNECTION_REFUSED instead)
 */
export const NETWORK_ERROR_IGNORE: string[] = [
  'net::ERR_ABORTED',
  'net::ERR_NETWORK_IO_SUSPENDED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_INTERNET_DISCONNECTED',
];

// ─── 5. Tunables (env-overridable) ───────────────────────────────────────────

export const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY || 8);   // parallel pages
export const RETRIES = Number(process.env.SMOKE_RETRIES || 1);           // retries per page
export const NAV_TIMEOUT_MS = Number(process.env.SMOKE_NAV_TIMEOUT || 45_000);
export const TEST_TIMEOUT_MS = Number(process.env.SMOKE_TEST_TIMEOUT || 90_000);
/** How long to wait for network-idle after DOMContentLoaded before giving up
 *  (marketing pixels can keep the network busy forever — not an error). */
export const NETWORK_IDLE_TIMEOUT_MS = 15_000;
/** Extra settle time after load so JS-initialized widgets can render. */
export const SETTLE_DELAY_MS = 2_000;
/** Minimum number of URLs the Elements Panel must yield before we trust it;
 *  below this we assume the scrape broke and fall back to urls.txt. */
export const MIN_EXPECTED_URLS = 50;
/** Seed pages whose HTML contains the Elements Panel (any demo page works).
 *  Tried in order until one yields enough links. */
export const DISCOVERY_SEED_PATHS = ['/advanced-search/', '/countdown/', '/team-members/'];

// ─── Helpers used by the test logic (no need to edit) ────────────────────────

export function isFirstParty(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return FIRST_PARTY_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export function isIgnoredThirdPartyHost(url: string): boolean {
  try {
    const u = new URL(url);
    return THIRD_PARTY_IGNORE_HOSTS.some((h) => (u.hostname + u.pathname).includes(h));
  } catch {
    return false;
  }
}

export function isWarnOnlyFirstParty(url: string): boolean {
  return FIRST_PARTY_WARN_ONLY_PATTERNS.some((re) => re.test(url));
}

export function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}
