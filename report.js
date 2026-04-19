#!/usr/bin/env node
'use strict';

/**
 * report.js
 *
 * Reads reports/results.json (produced by compare.js) and generates
 * reports/report.html — a self-contained, dark-themed, interactive HTML report
 * with side-by-side baseline / current / diff views, filtering, and a lightbox.
 *
 * Images are referenced by relative paths on disk (not embedded as base64),
 * so the report stays tiny even with 100+ full-page screenshots.
 * Open it directly in a browser — `<img src>` paths resolve correctly via
 * the file:// protocol as long as the screenshots/ folder is in the same
 * project root.
 *
 * Usage:
 *   node report.js
 */

const path = require('path');
const fs   = require('fs');
const config = require('./config');

const RESULTS_PATH = path.join(config.dirs.reports, 'results.json');
const REPORT_PATH  = path.join(config.dirs.reports, 'report.html');

// ── Escape HTML special characters ───────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Compute a relative path from the report file to an image file ─────────────
// Results.json stores paths relative to project root.
// The report is inside reports/, so images need an extra "../" prefix.
function imgSrc(relPathFromRoot) {
  if (!relPathFromRoot) return null;
  const abs        = path.resolve(process.cwd(), relPathFromRoot);
  const reportDir  = path.dirname(path.resolve(REPORT_PATH));
  return path.relative(reportDir, abs).replace(/\\/g, '/');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(RESULTS_PATH)) {
    console.error(`results.json not found at: ${RESULTS_PATH}`);
    console.error('Run `npm run compare` first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
  const { summary, results, timestamp, config: runConfig } = data;

  console.log(`Generating report for ${results.length} results…`);

  // Sort: fail → missing → error → new → pass
  // Within each group, sort by diffPercent descending (worst first)
  const priority = { fail: 0, missing: 1, error: 2, new: 3, pass: 4 };
  const sorted = [...results].sort((a, b) => {
    const pd = (priority[a.status] ?? 5) - (priority[b.status] ?? 5);
    if (pd !== 0) return pd;
    return (b.diffPercent ?? 0) - (a.diffPercent ?? 0);
  });

  // ── Build one <article> card per result ────────────────────────────────────
  const cards = sorted.map((r, i) => {
    const base = imgSrc(r.baselinePath);
    const curr = imgSrc(r.currentPath);
    const diff = imgSrc(r.diffPath);

    const pctStr = typeof r.diffPercent === 'number'
      ? `${r.diffPercent.toFixed(3)}%`
      : '—';

    const badgeHtml = {
      pass:    '<span class="badge pass">PASS</span>',
      fail:    '<span class="badge fail">FAIL</span>',
      missing: '<span class="badge miss">MISS</span>',
      error:   '<span class="badge err">ERR</span>',
      new:     '<span class="badge new">NEW</span>',
    }[r.status] ?? `<span class="badge">${esc(r.status)}</span>`;

    // ── Card body content depends on status ──────────────────────────────
    let body = '';

    if ((r.status === 'pass' || r.status === 'fail') && base && curr) {
      // Side-by-side trio: baseline | current | diff
      body = `
        <div class="trio">
          <figure>
            <figcaption>Baseline</figcaption>
            <img src="${esc(base)}" alt="baseline screenshot" loading="lazy" onclick="zoom(this)">
          </figure>
          <figure>
            <figcaption>Current</figcaption>
            <img src="${esc(curr)}" alt="current screenshot" loading="lazy" onclick="zoom(this)">
          </figure>
          <figure>
            <figcaption>Diff ${pctStr !== '—' ? `(${esc(pctStr)} pixels changed)` : ''}</figcaption>
            ${diff
              ? `<img src="${esc(diff)}" alt="diff image" loading="lazy" onclick="zoom(this)">`
              : '<div class="placeholder">No diff image</div>'}
          </figure>
        </div>`;

    } else if (r.status === 'new' && curr) {
      body = `
        <div class="trio">
          <figure>
            <figcaption>New Screenshot (no baseline yet)</figcaption>
            <img src="${esc(curr)}" alt="new page screenshot" loading="lazy" onclick="zoom(this)">
          </figure>
        </div>
        <p class="note new-note">${esc(r.note ?? '')}</p>`;

    } else if (r.status === 'missing') {
      body = `<p class="note miss-note">⚠ ${esc(r.error ?? 'Current screenshot not found.')}</p>`;

    } else if (r.status === 'error') {
      body = `<p class="note err-note">Error: ${esc(r.error ?? 'Unknown error')}</p>`;
    }

    // Passing cards start collapsed to keep the initial page fast to scan
    const collapsed = r.status === 'pass' ? ' collapsed' : '';

    return `
  <article class="card${collapsed}" id="c${i}" data-status="${esc(r.status)}">
    <header class="card-hd" onclick="toggle(${i})">
      ${badgeHtml}
      <span class="page-name">${esc(r.name)}</span>
      <span class="vp-chip">${esc(r.viewport)}</span>
      <span class="pct-cell">${esc(pctStr)}</span>
      <span class="chev">›</span>
    </header>
    <div class="card-bd">${body}</div>
  </article>`;
  }).join('');

  const runDate = new Date(timestamp).toLocaleString('en-US', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });

  // ── Full HTML document ─────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual Regression — Essential Addons for Elementor</title>
<style>
/* ── Design tokens ─────────────────────────────────────────────────────────── */
:root {
  --bg:       #0d1117;
  --surface:  #161b22;
  --border:   #30363d;
  --text:     #c9d1d9;
  --muted:    #8b949e;
  --link:     #58a6ff;

  --pass-bg:  rgba(35,134,54,.15);   --pass-border: #238636;  --pass-fg:  #56d364;
  --fail-bg:  rgba(218,54,51,.15);   --fail-border: #da3633;  --fail-fg:  #f85149;
  --miss-bg:  rgba(210,153,34,.15);  --miss-border: #d29922;  --miss-fg:  #e3b341;
  --err-bg:   rgba(137,87,229,.15);  --err-border:  #8957e5;  --err-fg:   #d2a8ff;
  --new-bg:   rgba(31,111,235,.15);  --new-border:  #1f6feb;  --new-fg:   #79c0ff;
}

/* ── Reset ─────────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; }

/* ── Top header ─────────────────────────────────────────────────────────────── */
.top-bar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 20px 28px;
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.top-bar h1 { font-size: 18px; font-weight: 700; flex: 1; min-width: 200px; }
.run-meta { color: var(--muted); font-size: 12px; }

/* ── Summary tiles ──────────────────────────────────────────────────────────── */
.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 16px 28px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 20px;
  border-radius: 8px;
  border: 1px solid var(--border);
  min-width: 82px;
}
.tile .n { font-size: 28px; font-weight: 700; line-height: 1; }
.tile .l { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-top: 4px; }
.tile.t-all  { }
.tile.t-pass { background: var(--pass-bg); border-color: var(--pass-border); }  .tile.t-pass .n { color: var(--pass-fg); }
.tile.t-fail { background: var(--fail-bg); border-color: var(--fail-border); }  .tile.t-fail .n { color: var(--fail-fg); }
.tile.t-miss { background: var(--miss-bg); border-color: var(--miss-border); }  .tile.t-miss .n { color: var(--miss-fg); }
.tile.t-err  { background: var(--err-bg);  border-color: var(--err-border);  }  .tile.t-err  .n { color: var(--err-fg);  }
.tile.t-new  { background: var(--new-bg);  border-color: var(--new-border);  }  .tile.t-new  .n { color: var(--new-fg);  }

/* ── Sticky controls bar ────────────────────────────────────────────────────── */
.controls {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.controls input[type=search] {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 13px;
  width: 220px;
  outline: none;
}
.controls input:focus { border-color: var(--link); }
.btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  line-height: 1.4;
}
.btn:hover  { border-color: var(--muted); }
.btn.active { background: #1f6feb; border-color: var(--link); color: #fff; }
.sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }

/* ── Result list ────────────────────────────────────────────────────────────── */
.results { padding: 16px 28px; display: flex; flex-direction: column; gap: 6px; }

/* ── Individual result card ─────────────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.card.collapsed .card-bd { display: none; }
.card[data-status=fail]    { border-left: 3px solid var(--fail-border); }
.card[data-status=missing] { border-left: 3px solid var(--miss-border); }
.card[data-status=error]   { border-left: 3px solid var(--err-border);  }
.card[data-status=new]     { border-left: 3px solid var(--new-border);  }

.card-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}
.card-hd:hover { background: rgba(255,255,255,.025); }

.page-name  { flex: 1; font-size: 13px; font-weight: 500; word-break: break-word; }
.vp-chip    { font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(255,255,255,.07); color: var(--muted); }
.pct-cell   { font-family: monospace; font-size: 12px; color: var(--muted); min-width: 72px; text-align: right; }
.chev       { color: var(--muted); font-size: 15px; transition: transform .15s; display: inline-block; flex-shrink: 0; }
.card:not(.collapsed) .chev { transform: rotate(90deg); }

/* ── Status badges ──────────────────────────────────────────────────────────── */
.badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: .5px;
  min-width: 40px;
  text-align: center;
  flex-shrink: 0;
}
.badge.pass { background: var(--pass-bg); color: var(--pass-fg); border: 1px solid var(--pass-border); }
.badge.fail { background: var(--fail-bg); color: var(--fail-fg); border: 1px solid var(--fail-border); }
.badge.miss { background: var(--miss-bg); color: var(--miss-fg); border: 1px solid var(--miss-border); }
.badge.err  { background: var(--err-bg);  color: var(--err-fg);  border: 1px solid var(--err-border);  }
.badge.new  { background: var(--new-bg);  color: var(--new-fg);  border: 1px solid var(--new-border);  }

/* ── Screenshot trio ────────────────────────────────────────────────────────── */
.card-bd { padding: 0 14px 14px; }
.trio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 12px;
}
figure { display: flex; flex-direction: column; gap: 6px; }
figcaption {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .5px;
}
figure img {
  width: 100%;
  border-radius: 4px;
  border: 1px solid var(--border);
  cursor: zoom-in;
  max-height: 440px;
  object-fit: contain;
  background: #0a0e14;
  display: block;
}
figure img:hover { border-color: var(--muted); }
.placeholder {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  background: rgba(0,0,0,.2);
  border-radius: 4px;
  font-size: 12px;
}
.note {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(0,0,0,.2);
  color: var(--muted);
}
.miss-note { color: var(--miss-fg); }
.err-note  { color: var(--err-fg); font-family: monospace; }
.new-note  { color: var(--new-fg); }

/* ── Lightbox ────────────────────────────────────────────────────────────────── */
#lb {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0,0,0,.93);
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
#lb.open { display: flex; }
#lb img  { max-width: 96vw; max-height: 96vh; border-radius: 4px; box-shadow: 0 0 60px rgba(0,0,0,.8); }

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.empty { text-align: center; padding: 40px; color: var(--muted); font-size: 14px; }

/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 800px) {
  .trio { grid-template-columns: 1fr; }
  .results, .summary, .controls, .top-bar { padding-left: 14px; padding-right: 14px; }
}
</style>
</head>
<body>

<!-- ── Header ────────────────────────────────────────────────────────────────── -->
<div class="top-bar">
  <h1>Visual Regression Report — Essential Addons for Elementor</h1>
  <span class="run-meta">
    ${esc(runDate)}
    &nbsp;·&nbsp; pixel sensitivity: ${esc(String(runConfig.diffThreshold))}
    &nbsp;·&nbsp; fail threshold: &gt;${esc(String(runConfig.failThreshold))}%
    &nbsp;·&nbsp; viewports: ${esc(runConfig.viewports.join(', '))}
  </span>
</div>

<!-- ── Summary tiles ─────────────────────────────────────────────────────────── -->
<div class="summary">
  <div class="tile t-all">  <span class="n">${summary.total}</span>   <span class="l">Total</span>   </div>
  <div class="tile t-pass"> <span class="n">${summary.pass}</span>    <span class="l">Passed</span>  </div>
  <div class="tile t-fail"> <span class="n">${summary.fail}</span>    <span class="l">Failed</span>  </div>
  <div class="tile t-miss"> <span class="n">${summary.missing}</span> <span class="l">Missing</span> </div>
  <div class="tile t-new">  <span class="n">${summary.new}</span>     <span class="l">New</span>     </div>
  <div class="tile t-err">  <span class="n">${summary.error}</span>   <span class="l">Errors</span>  </div>
</div>

<!-- ── Controls ──────────────────────────────────────────────────────────────── -->
<div class="controls">
  <input id="q" type="search" placeholder="Filter by page name…" oninput="applyFilters()" autocomplete="off">
  <span class="sep"></span>
  <button class="btn active" data-f="" onclick="setFilter('',this)">All</button>
  <button class="btn" data-f="fail"    onclick="setFilter('fail',this)">Failed (${summary.fail})</button>
  <button class="btn" data-f="missing" onclick="setFilter('missing',this)">Missing (${summary.missing})</button>
  <button class="btn" data-f="new"     onclick="setFilter('new',this)">New (${summary.new})</button>
  <button class="btn" data-f="pass"    onclick="setFilter('pass',this)">Passed (${summary.pass})</button>
  <span class="sep"></span>
  <button class="btn" onclick="expandAll()">Expand All</button>
  <button class="btn" onclick="collapseAll()">Collapse All</button>
</div>

<!-- ── Result cards ───────────────────────────────────────────────────────────── -->
<section class="results" id="results">
${cards}
</section>

<div id="no-results" class="empty" style="display:none">No matching results.</div>

<!-- ── Lightbox ──────────────────────────────────────────────────────────────── -->
<div id="lb" onclick="closeLb()">
  <img id="lb-img" src="" alt="Zoomed screenshot">
</div>

<script>
var activeFilter = '';

function toggle(i) {
  var c = document.getElementById('c' + i);
  c.classList.toggle('collapsed');
}

function expandAll() {
  eachVisible(function(c) { c.classList.remove('collapsed'); });
}

function collapseAll() {
  eachVisible(function(c) { c.classList.add('collapsed'); });
}

function eachVisible(fn) {
  document.querySelectorAll('.card').forEach(function(c) {
    if (c.style.display !== 'none') fn(c);
  });
}

function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.controls .btn[data-f]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.f === f);
  });
  applyFilters();
}

function applyFilters() {
  var q = (document.getElementById('q').value || '').toLowerCase();
  var anyVisible = false;

  document.querySelectorAll('.card').forEach(function(c) {
    var name   = c.querySelector('.page-name').textContent.toLowerCase();
    var status = c.dataset.status || '';
    var show   = (!q || name.includes(q)) && (!activeFilter || status === activeFilter);
    c.style.display = show ? '' : 'none';
    if (show) anyVisible = true;
  });

  document.getElementById('no-results').style.display = anyVisible ? 'none' : '';
}

function zoom(img) {
  document.getElementById('lb-img').src = img.src;
  document.getElementById('lb').classList.add('open');
}

function closeLb() {
  document.getElementById('lb').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLb();
});
</script>
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, html, 'utf-8');

  console.log(`\nReport saved → ${REPORT_PATH}`);
  console.log('\nTo open:');
  console.log(`  macOS  : open ${REPORT_PATH}`);
  console.log(`  Windows: start ${REPORT_PATH}`);
  console.log(`  Linux  : xdg-open ${REPORT_PATH}\n`);
}

main();
