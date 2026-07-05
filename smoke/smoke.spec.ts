/**
 * smoke.spec.ts
 *
 * One test per discovered demo page. Each test loads the page in headless
 * Chromium and collects:
 *   - uncaught JS exceptions + console.error output
 *   - failed network requests / HTTP >= 400 responses (first- vs third-party)
 *   - PHP error signatures in the rendered HTML
 *   - Elementor widget presence & rendering
 *
 * Classification into build-failing errors vs. warnings is driven entirely
 * by ignore-config.ts (the campaign/third-party ignore layer).
 */

import * as fs from 'fs';
import * as path from 'path';
import { test } from '@playwright/test';
import {
  isFirstParty,
  isIgnoredThirdPartyHost,
  isWarnOnlyFirstParty,
  matchesAny,
  CONSOLE_IGNORE_PATTERNS,
  PAGEERROR_IGNORE_PATTERNS,
  NETWORK_IDLE_TIMEOUT_MS,
  SETTLE_DELAY_MS,
  NETWORK_ERROR_IGNORE,
} from './ignore-config';
import { expectedWidget } from './widget-map';
import { scanForPhpErrors, runRenderChecks, Finding, PageResult } from './checks';
import { URLS_FILE, PAGES_DIR } from './global-setup';

interface UrlsFile {
  pages: { url: string; slug: string; source: string }[];
}

if (!fs.existsSync(URLS_FILE)) {
  throw new Error(
    `${URLS_FILE} not found — run via "npx playwright test --config=playwright.smoke.config.ts" so globalSetup performs URL discovery first.`,
  );
}
const { pages }: UrlsFile = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'));

const fileNameFor = (slug: string) => slug.replace(/[^a-z0-9-]/gi, '__') + '.json';

for (const demo of pages) {
  test(demo.slug, async ({ page }) => {
    const failures: Finding[] = [];
    const warnings: Finding[] = [];
    const started = Date.now();

    // ── Listeners (registered before navigation) ──────────────────────────
    page.on('pageerror', (err) => {
      const text = `${err.message}\n${err.stack || ''}`;
      const thirdParty = /https?:\/\/[^\s)]+/.test(err.stack || '')
        && ![...(err.stack || '').matchAll(/https?:\/\/[^\s):]+/g)].some((m) => isFirstParty(m[0]));
      const finding: Finding = {
        type: 'js-error',
        message: `Uncaught exception: ${err.message.slice(0, 300)}`,
        detail: (err.stack || '').split('\n').slice(0, 4).join(' | '),
      };
      if (thirdParty || matchesAny(text, PAGEERROR_IGNORE_PATTERNS)) warnings.push(finding);
      else failures.push(finding);
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const srcUrl = msg.location()?.url || '';
      const finding: Finding = {
        type: 'js-error',
        message: `console.error: ${text.slice(0, 300)}`,
        detail: srcUrl ? `source: ${srcUrl}` : undefined,
      };
      const ignorable =
        matchesAny(text, CONSOLE_IGNORE_PATTERNS) ||
        (srcUrl !== '' && !isFirstParty(srcUrl)); // errors logged by third-party scripts
      if (ignorable) warnings.push(finding);
      else failures.push(finding);
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      const errText = req.failure()?.errorText || 'unknown';
      if (NETWORK_ERROR_IGNORE.includes(errText)) return; // client-side artifacts — noise
      if (isIgnoredThirdPartyHost(url)) return;
      const finding: Finding = {
        type: 'network',
        message: `Request failed (${errText}): ${url.slice(0, 200)}`,
      };
      if (isFirstParty(url) && !isWarnOnlyFirstParty(url)) failures.push(finding);
      else warnings.push(finding);
    });

    page.on('response', (res) => {
      if (res.status() < 400) return;
      const url = res.url();
      if (isIgnoredThirdPartyHost(url)) return;
      const finding: Finding = {
        type: 'network',
        message: `HTTP ${res.status()}: ${url.slice(0, 200)}`,
        detail: res.request().resourceType(),
      };
      if (isFirstParty(url) && !isWarnOnlyFirstParty(url)) failures.push(finding);
      else warnings.push(finding);
    });

    // ── Navigate ──────────────────────────────────────────────────────────
    // goto() throws on network-level failures (timeout, DNS, connection
    // reset). Catch it so the per-page result file is still written — the
    // finding below fails the test with the same information.
    let status: number | null = null;
    let finalUrl = demo.url;
    let response = null;
    try {
      response = await page.goto(demo.url, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      failures.push({
        type: 'navigation',
        message: `Navigation failed: ${(err as Error).message.split('\n')[0].slice(0, 250)}`,
      });
    }
    if (!response) {
      if (failures.length === 0) {
        failures.push({ type: 'navigation', message: `No response for ${demo.url}` });
      }
    } else {
      status = response.status();
      finalUrl = page.url();
      if (status >= 400) {
        failures.push({
          type: 'navigation',
          message: `Demo page returned HTTP ${status}`,
          detail: `requested ${demo.url} → final ${finalUrl}`,
        });
      }
    }

    if (response && status !== null && status < 400) {
      // marketing pixels can keep the network busy forever — idle is best-effort
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

      // light scroll pass so lazy-loading widgets initialize
      await page
        .evaluate(async () => {
          const step = 1200;
          const max = Math.min(document.body.scrollHeight, 20000);
          for (let y = 0; y < max; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 100));
          }
          window.scrollTo(0, 0);
        })
        .catch(() => {});
      await page.waitForTimeout(SETTLE_DELAY_MS);

      // ── PHP errors in HTML ──────────────────────────────────────────────
      const html = await page.content();
      failures.push(...scanForPhpErrors(html));

      // ── Rendering / widget presence ─────────────────────────────────────
      const expectation = expectedWidget(demo.slug);
      const render = await runRenderChecks(page, expectation.selector);

      if (render.bodyTextLength < 50 && render.totalWidgets === 0) {
        failures.push({
          type: 'php-error',
          message: 'White screen — page body is empty',
          detail: `body text length: ${render.bodyTextLength}`,
        });
      } else if (render.totalWidgets === 0) {
        failures.push({
          type: 'render',
          message: 'No Elementor widgets rendered on the page',
        });
      }

      if (expectation.selector) {
        if (!render.primaryWidgetFound) {
          const finding: Finding = {
            type: 'render',
            message: `Expected primary widget not found: ${expectation.selector}`,
            detail: expectation.strict
              ? undefined
              : 'unverified auto-derived selector — map this slug in smoke/widget-map.ts',
          };
          (expectation.strict ? failures : warnings).push(finding);
        } else if (render.primaryWidgetEmpty) {
          (expectation.strict ? failures : warnings).push({
            type: 'render',
            message: `Primary widget ${expectation.selector} rendered EMPTY`,
          });
        }
      }

      for (const cls of render.emptyEaelContainers) {
        warnings.push({
          type: 'render',
          message: `Widget container is empty: .${cls}`,
        });
      }
    }

    // ── Persist result (last attempt wins across retries) ─────────────────
    const result: PageResult = {
      url: demo.url,
      finalUrl,
      slug: demo.slug,
      status,
      durationMs: Date.now() - started,
      failures,
      warnings,
    };
    fs.writeFileSync(path.join(PAGES_DIR, fileNameFor(demo.slug)), JSON.stringify(result, null, 2));

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} problem(s) on ${finalUrl}:\n` +
          failures.map((f) => `  [${f.type}] ${f.message}${f.detail ? ` (${f.detail})` : ''}`).join('\n'),
      );
    }
  });
}
