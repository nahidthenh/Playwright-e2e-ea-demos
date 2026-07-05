/**
 * global-teardown.ts
 *
 * Runs once after all workers finish. Aggregates the per-page JSON results
 * into:
 *   1. smoke-results/summary.json           — machine-readable artifact
 *   2. $GITHUB_STEP_SUMMARY                 — markdown report grouped by problem type
 *   3. ::error / ::warning stdout lines     — GitHub annotations, one per page
 *
 * Warnings never fail the build; the exit code is decided by the test runner
 * (a page test fails only when it has build-failing findings).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PageResult, Finding, FindingType } from './checks';
import { RESULTS_DIR, URLS_FILE, PAGES_DIR } from './global-setup';

const TYPE_LABELS: Record<FindingType, string> = {
  'php-error': '🐘 PHP errors',
  'js-error': '🟨 JS errors',
  'network': '🌐 Network failures',
  'render': '🧩 Broken rendering',
  'navigation': '🚫 Page load failures',
};

// GitHub workflow-command escaping (newlines/percent must be encoded)
const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export default async function globalTeardown() {
  if (!fs.existsSync(PAGES_DIR)) return;

  const results: PageResult[] = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PAGES_DIR, f), 'utf8')));

  const discovery = fs.existsSync(URLS_FILE)
    ? JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'))
    : { warnings: [], pages: [] };

  // A page that crashed or hit the hard test timeout never writes its result
  // file — surface it as a failure instead of silently omitting it.
  // (Skipped for filtered runs like `-g <slug>`, detected by low coverage.)
  const seen = new Set(results.map((r) => r.slug));
  const fullRun = results.length >= (discovery.pages?.length || 0) * 0.9;
  for (const p of fullRun ? (discovery.pages as { url: string; slug: string }[]) : []) {
    if (!seen.has(p.slug)) {
      results.push({
        url: p.url,
        finalUrl: p.url,
        slug: p.slug,
        status: null,
        durationMs: 0,
        failures: [
          {
            type: 'navigation',
            message: 'No result recorded — the page test timed out or crashed (see Playwright report)',
          },
        ],
        warnings: [],
      });
    }
  }
  results.sort((a, b) => a.slug.localeCompare(b.slug));

  const failed = results.filter((r) => r.failures.length > 0);
  const warned = results.filter((r) => r.failures.length === 0 && r.warnings.length > 0);
  const passed = results.filter((r) => r.failures.length === 0);

  // ── 1. JSON artifact ─────────────────────────────────────────────────────
  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      discovered: discovery.pages.length,
      tested: results.length,
      passed: passed.length,
      failed: failed.length,
      withWarnings: warned.length,
    },
    discoveryWarnings: discovery.warnings,
    pages: results,
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  // ── 2. GitHub annotations ────────────────────────────────────────────────
  if (process.env.GITHUB_ACTIONS) {
    for (const r of failed) {
      const lines = r.failures.map((f) => `[${f.type}] ${f.message}`).join('\n');
      console.log(`::error title=Demo smoke test — ${r.slug}::${esc(`${r.finalUrl}\n${lines}`)}`);
    }
    for (const r of results.filter((x) => x.warnings.length > 0)) {
      const lines = r.warnings.slice(0, 10).map((f) => `[${f.type}] ${f.message}`).join('\n');
      const more = r.warnings.length > 10 ? `\n…and ${r.warnings.length - 10} more` : '';
      console.log(`::warning title=Demo smoke test — ${r.slug} (non-blocking)::${esc(`${r.finalUrl}\n${lines}${more}`)}`);
    }
    for (const w of discovery.warnings as string[]) {
      console.log(`::warning title=URL discovery::${esc(w)}`);
    }
  }

  // ── 3. Markdown step summary ─────────────────────────────────────────────
  const md: string[] = [];
  md.push(`# 🔍 Demo Smoke Test — ${failed.length === 0 ? '✅ PASSED' : `❌ FAILED (${failed.length} page${failed.length > 1 ? 's' : ''})`}`);
  md.push('');
  md.push('| Discovered | Tested | Passed | Failed | With warnings |');
  md.push('|---:|---:|---:|---:|---:|');
  md.push(`| ${summary.totals.discovered} | ${summary.totals.tested} | ${summary.totals.passed} | ${summary.totals.failed} | ${summary.totals.withWarnings} |`);
  md.push('');

  // failures grouped by problem type
  if (failed.length > 0) {
    md.push('## ❌ Build-failing problems');
    const byType = new Map<FindingType, { page: PageResult; finding: Finding }[]>();
    for (const r of failed) {
      for (const f of r.failures) {
        if (!byType.has(f.type)) byType.set(f.type, []);
        byType.get(f.type)!.push({ page: r, finding: f });
      }
    }
    for (const [type, entries] of byType) {
      md.push(`### ${TYPE_LABELS[type]} (${entries.length})`);
      md.push('');
      for (const { page, finding } of entries) {
        md.push(`- **[${page.slug}](${page.finalUrl})** — ${finding.message}${finding.detail ? `<br><sub>${finding.detail}</sub>` : ''}`);
      }
      md.push('');
    }
  }

  // warnings (never fail the build)
  const allWarnPages = results.filter((r) => r.warnings.length > 0);
  if (allWarnPages.length > 0) {
    md.push('## ⚠️ Warnings (third-party / campaign noise — non-blocking)');
    md.push('');
    md.push('<details><summary>Show ' + allWarnPages.reduce((n, r) => n + r.warnings.length, 0) + ' warnings on ' + allWarnPages.length + ' pages</summary>');
    md.push('');
    for (const r of allWarnPages) {
      md.push(`- **[${r.slug}](${r.finalUrl})**`);
      for (const w of r.warnings.slice(0, 15)) {
        md.push(`  - \`${w.type}\` ${w.message.replace(/`/g, "'")}`);
      }
      if (r.warnings.length > 15) md.push(`  - …and ${r.warnings.length - 15} more`);
    }
    md.push('');
    md.push('</details>');
    md.push('');
  }

  if (discovery.warnings.length > 0) {
    md.push('## 🔎 URL discovery warnings');
    md.push('');
    for (const w of discovery.warnings) md.push(`- ${w}`);
    md.push('');
  }

  const markdown = md.join('\n');
  fs.writeFileSync(path.join(RESULTS_DIR, 'summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }

  console.log(
    `[smoke] ${summary.totals.tested} pages tested — ${summary.totals.passed} passed, ` +
      `${summary.totals.failed} failed, ${summary.totals.withWarnings} with warnings only`,
  );
}
