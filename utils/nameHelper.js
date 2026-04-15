/**
 * Converts a full URL into a clean, filesystem-safe test name.
 *
 * Strategy:
 *  1. Parse the URL to extract only the pathname (ignores protocol, host, query, hash).
 *  2. Split the pathname on '/' and take the last meaningful segment.
 *     - If the last segment is empty (trailing slash), take the second-to-last.
 *     - For /elementor/advanced-tabs/ → "advanced-tabs"
 *     - For /elementor/advanced-tabs  → "advanced-tabs"
 *  3. Lowercase and replace any remaining special characters with hyphens.
 *
 * @param {string} url - Full URL string.
 * @returns {string} - Short, human-readable test name.
 *
 * @example
 *   urlToTestName('https://essential-addons.com/elementor/advanced-tabs/')
 *   // → 'advanced-tabs'
 *
 *   urlToTestName('https://essential-addons.com/elementor/woo-checkout')
 *   // → 'woo-checkout'
 *
 *   urlToTestName('https://essential-addons.com/360-degree-photo-viewer/')
 *   // → '360-degree-photo-viewer'
 */
function urlToTestName(url) {
  let pathname;

  try {
    pathname = new URL(url).pathname;
  } catch {
    // Fallback: treat the whole string as a path if URL parsing fails
    pathname = url;
  }

  // Split on '/', filter out empty strings (leading slash + trailing slash)
  const segments = pathname.split('/').filter(Boolean);

  // Take the last segment — this is the widget/extension slug
  const slug = segments[segments.length - 1] ?? 'unknown';

  // Lowercase and sanitise: keep alphanumerics and hyphens only
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // replace non-slug chars with hyphen
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens
}

/**
 * Builds a fully-qualified snapshot name that includes the URL segment path,
 * so tests for /elementor/advanced-tabs and /advanced-tabs are kept separate.
 *
 * Example:
 *   urlToSnapshotName('https://essential-addons.com/elementor/advanced-tabs/')
 *   // → 'elementor--advanced-tabs'
 *
 * @param {string} url
 * @returns {string}
 */
function urlToSnapshotName(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  const segments = pathname.split('/').filter(Boolean);

  return segments
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .join('--'); // double-hyphen separates path segments unambiguously
}

module.exports = { urlToTestName, urlToSnapshotName };
