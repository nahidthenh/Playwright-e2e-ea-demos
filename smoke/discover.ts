/**
 * discover.ts
 *
 * Discovers every demo-page URL at runtime — nothing is hardcoded.
 *
 * Source priority (adapted to how essential-addons.com is actually built):
 *
 *   1. ELEMENTS PANEL (primary) — every demo page embeds an off-canvas
 *      "Elements Panel" whose grid links to every widget/extension demo as
 *      https://essential-addons.com/elementor/<slug>/. The panel is
 *      server-rendered, so a plain HTML fetch of any demo page yields the
 *      full list (~110 links).
 *
 *   2. SITEMAP (cross-check) — /sitemap_index.xml → page-sitemap.xml is
 *      fetched too, but it CANNOT be the primary source: demo pages live at
 *      root-level slugs (/advanced-search/) indistinguishable from marketing
 *      pages (/pricing/, /web-design-ebook/…). It is used to cross-check the
 *      panel list: a panel link whose canonical URL is missing from the
 *      sitemap is flagged as a discovery warning (likely an unpublished or
 *      broken link).
 *
 *   3. urls.txt (fallback) — the repo's curated list, used only if the panel
 *      scrape yields fewer than MIN_EXPECTED_URLS links (site down, panel
 *      redesigned, …), so the smoke test still runs.
 *
 * Normalization: the panel HTML contains malformed hrefs (trailing spaces /
 * encoded %20, e.g. ".../post-timeline/%20") — these are stripped, URLs are
 * lower-cased on the host, given exactly one trailing slash, and deduped.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BASE_URL,
  DISCOVERY_SEED_PATHS,
  MIN_EXPECTED_URLS,
  SKIP_SLUGS,
} from './ignore-config';

export interface DemoPage {
  /** URL to navigate to (the /elementor/<slug>/ form the panel publishes —
   *  loading it also validates the redirect to the canonical page). */
  url: string;
  /** Slug used for widget mapping and result file names. */
  slug: string;
  /** Where this URL came from: 'panel' | 'urls.txt'. */
  source: string;
}

export interface DiscoveryResult {
  pages: DemoPage[];
  /** Non-fatal issues found during discovery (reported as warnings). */
  warnings: string[];
}

async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'EA-Demo-Smoke-Test/1.0 (+github-actions)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

/** Strip whitespace + encoded spaces, normalize to exactly one trailing slash. */
export function normalizeHref(raw: string): string | null {
  let href = raw.trim().replace(/%20/gi, '').replace(/\s+/g, '');
  if (!href) return null;
  try {
    const u = new URL(href);
    u.hash = '';
    u.search = '';
    let p = u.pathname.replace(/\/{2,}/g, '/');
    if (!p.endsWith('/')) p += '/';
    if (p === '/') return null; // homepage isn't a demo
    return `${u.protocol}//${u.hostname}${p}`;
  } catch {
    return null;
  }
}

/** Slug = path after /elementor/, without the trailing slash. */
export function slugFromUrl(url: string): string {
  const p = new URL(url).pathname;
  return p.replace(/^\/elementor\//, '').replace(/^\//, '').replace(/\/$/, '');
}

/** 1. Primary: scrape the Elements Panel grid from a seed demo page. */
async function discoverFromPanel(warnings: string[]): Promise<DemoPage[]> {
  const base = new URL(BASE_URL);
  for (const seedPath of DISCOVERY_SEED_PATHS) {
    const seedUrl = new URL(seedPath, BASE_URL).toString();
    try {
      const html = await fetchText(seedUrl);
      const re = new RegExp(
        `href="(https?://${base.hostname.replace(/\./g, '\\.')}/elementor/[^"]+)"`,
        'g',
      );
      const urls = new Set<string>();
      for (const m of html.matchAll(re)) {
        const norm = normalizeHref(m[1]);
        if (norm) urls.add(norm);
      }
      if (urls.size >= MIN_EXPECTED_URLS) {
        return [...urls].sort().map((url) => ({ url, slug: slugFromUrl(url), source: 'panel' }));
      }
      warnings.push(`Panel scrape of ${seedUrl} yielded only ${urls.size} links — trying next seed.`);
    } catch (err) {
      warnings.push(`Panel scrape of ${seedUrl} failed: ${(err as Error).message}`);
    }
  }
  return [];
}

/** 2. Cross-check: canonical URL of every page should appear in the sitemap. */
async function crossCheckSitemap(pages: DemoPage[], warnings: string[]): Promise<void> {
  try {
    const index = await fetchText(new URL('/sitemap_index.xml', BASE_URL).toString());
    const sitemapUrls = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const inSitemap = new Set<string>();
    for (const sm of sitemapUrls) {
      try {
        const xml = await fetchText(sm);
        for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          const norm = normalizeHref(m[1]);
          if (norm) inSitemap.add(norm);
        }
      } catch {
        /* individual sub-sitemap failures are non-fatal */
      }
    }
    for (const page of pages) {
      // panel links use /elementor/<slug>/ which 301s to the canonical /<slug>/
      const canonical = normalizeHref(new URL('/' + page.slug + '/', BASE_URL).toString());
      if (canonical && !inSitemap.has(canonical) && !inSitemap.has(page.url)) {
        warnings.push(
          `Panel links to ${page.url} but ${canonical} is not in the sitemap — possibly unpublished or a broken link.`,
        );
      }
    }
  } catch (err) {
    warnings.push(`Sitemap cross-check skipped: ${(err as Error).message}`);
  }
}

/** 3. Fallback: the repo's curated urls.txt. */
function discoverFromUrlsTxt(warnings: string[]): DemoPage[] {
  const file = path.resolve(__dirname, '..', 'urls.txt');
  if (!fs.existsSync(file)) return [];
  warnings.push('Elements Panel scrape failed — fell back to the static urls.txt list.');
  const urls = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const norm = normalizeHref(line);
    if (norm) urls.add(norm);
  }
  return [...urls].sort().map((url) => ({ url, slug: slugFromUrl(url), source: 'urls.txt' }));
}

export async function discoverDemoPages(): Promise<DiscoveryResult> {
  const warnings: string[] = [];

  let pages = await discoverFromPanel(warnings);
  if (pages.length === 0) pages = discoverFromUrlsTxt(warnings);
  if (pages.length === 0) {
    throw new Error(
      `URL discovery failed completely: panel scrape returned nothing and urls.txt is empty/missing. Warnings: ${warnings.join(' | ')}`,
    );
  }

  pages = pages.filter((p) => !SKIP_SLUGS.includes(p.slug));
  await crossCheckSitemap(pages, warnings);

  return { pages, warnings };
}
