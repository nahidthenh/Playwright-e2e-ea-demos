/**
 * checks.ts
 *
 * Per-page check implementations and result types. Test logic only —
 * everything ignorable/tunable lives in ignore-config.ts.
 */

import type { Page } from '@playwright/test';
import { CAMPAIGN_SELECTORS } from './ignore-config';

// ─── Result types ────────────────────────────────────────────────────────────

export type FindingType =
  | 'php-error'          // PHP error text in the HTML / WP critical error / white screen
  | 'js-error'           // uncaught exception or console.error
  | 'network'            // failed request or HTTP >= 400
  | 'render'             // missing/empty widget, no Elementor content
  | 'navigation';        // page itself failed to load

export interface Finding {
  type: FindingType;
  message: string;
  detail?: string;
}

export interface PageResult {
  url: string;
  finalUrl: string;
  slug: string;
  status: number | null;       // HTTP status of the main document
  durationMs: number;
  failures: Finding[];         // fail the build
  warnings: Finding[];         // reported, never fail the build
}

// ─── PHP error detection ─────────────────────────────────────────────────────

/**
 * Patterns scanned (case-insensitively) against the rendered HTML.
 * Anchored variants (`:` suffixes, `on line`) keep marketing copy like
 * "warning signs" or docs text from false-positiving.
 */
const PHP_ERROR_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'PHP fatal error', re: /\bFatal error\b\s*(<\/b>)?\s*:/i },
  { name: 'PHP parse error', re: /\bParse error\b\s*(<\/b>)?\s*:/i },
  { name: 'PHP warning', re: /\bWarning\b\s*(<\/b>)?:\s+[^<>{}\n]{5,200}\bon line\b/i },
  { name: 'PHP notice', re: /\bNotice\b\s*(<\/b>)?:\s+[^<>{}\n]{5,200}\bon line\b/i },
  { name: 'PHP deprecated', re: /\bDeprecated\b\s*(<\/b>)?:\s+[^<>{}\n]{5,200}\bon line\b/i },
  { name: 'WP critical error', re: /There has been a critical error on this website/i },
  { name: 'Xdebug output', re: /\bXdebug\b/i },
  { name: 'PHP stack trace', re: /\bStack trace\b\s*:/i },
  { name: 'Uncaught PHP error', re: /\bUncaught (Error|Exception|TypeError|ArgumentCountError)\b/i },
];

/** Scan HTML for PHP error signatures; returns findings with a context snippet. */
export function scanForPhpErrors(html: string): Finding[] {
  const findings: Finding[] = [];
  for (const { name, re } of PHP_ERROR_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      const start = Math.max(0, m.index - 40);
      const snippet = html
        .slice(start, m.index + 200)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      findings.push({ type: 'php-error', message: name, detail: `…${snippet}…` });
    }
  }
  return findings;
}

// ─── In-browser rendering checks ─────────────────────────────────────────────

export interface RenderCheckResult {
  totalWidgets: number;            // .elementor-widget count outside campaign containers
  bodyTextLength: number;          // for white-screen detection
  primaryWidgetFound: boolean;     // expected selector matched (outside campaigns)
  primaryWidgetEmpty: boolean;     // matched but renders no content
  emptyEaelContainers: string[];   // other eael widgets with empty containers (warnings)
}

/**
 * Runs entirely in the page. Campaign containers (see CAMPAIGN_SELECTORS)
 * are excluded from every assertion — popups, banners and countdowns must
 * never influence pass/fail.
 */
export async function runRenderChecks(
  page: Page,
  expectedSelector: string | null,
): Promise<RenderCheckResult> {
  return page.evaluate(
    ({ campaignSelectors, expectedSelector }) => {
      const campaignSel = campaignSelectors.join(',');
      // A campaign "container" must be a real overlay/banner element — if a
      // selector accidentally matches <html>/<body> (WP puts plugin classes on
      // body), ignore that match instead of excluding the entire page.
      const inCampaign = (el: Element) => {
        if (!campaignSel) return false;
        let anc = el.closest(campaignSel);
        while (anc && (anc === document.body || anc === document.documentElement)) {
          anc = anc.parentElement ? anc.parentElement.closest(campaignSel) : null;
        }
        return anc !== null;
      };

      const hasContent = (el: Element) => {
        // a widget "renders" if it has visible text, media, or form controls
        if ((el.textContent || '').trim().length > 0) return true;
        return el.querySelector('img, svg, video, iframe, canvas, input, button, select, textarea') !== null;
      };

      const widgets = [...document.querySelectorAll('.elementor-widget')].filter((el) => !inCampaign(el));

      let primaryWidgetFound = false;
      let primaryWidgetEmpty = false;
      if (expectedSelector) {
        const matches = [...document.querySelectorAll(expectedSelector)].filter((el) => !inCampaign(el));
        primaryWidgetFound = matches.length > 0;
        primaryWidgetEmpty = primaryWidgetFound && !matches.some(hasContent);
      }

      // eael widgets whose .elementor-widget-container is completely empty
      const emptyEaelContainers: string[] = [];
      for (const w of widgets) {
        if (!/elementor-widget-eael-/.test(w.className)) continue;
        const container = w.querySelector(':scope > .elementor-widget-container');
        if (container && !hasContent(container)) {
          const cls = [...w.classList].find((c) => c.startsWith('elementor-widget-eael-'));
          if (cls && !emptyEaelContainers.includes(cls)) emptyEaelContainers.push(cls);
        }
      }

      return {
        totalWidgets: widgets.length,
        bodyTextLength: (document.body?.innerText || '').trim().length,
        primaryWidgetFound,
        primaryWidgetEmpty,
        emptyEaelContainers,
      };
    },
    { campaignSelectors: CAMPAIGN_SELECTORS, expectedSelector },
  );
}
