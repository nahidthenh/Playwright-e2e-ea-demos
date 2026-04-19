#!/usr/bin/env node
'use strict';

/**
 * compare.js
 *
 * Compares every PNG in screenshots/baseline/<viewport>/ against the matching
 * file in screenshots/current/<viewport>/ using pixelmatch, writes highlighted
 * diff images to screenshots/diff/<viewport>/, and produces reports/results.json
 * which report.js turns into an HTML report.
 *
 * Usage:
 *   node compare.js
 *   node compare.js --viewport=desktop
 *   node compare.js --viewport=desktop,tablet
 */

const path       = require('path');
const fs         = require('fs');
const { PNG }    = require('pngjs');
const pixelmatch = require('pixelmatch');
const config     = require('./config');

// ── Helpers ───────────────────────────────────────────────────────────────────
const ensureDir = d => fs.mkdirSync(d, { recursive: true });

const activeViewports = config.activeViewports; // always ['desktop']

// ── Image utilities ───────────────────────────────────────────────────────────

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

/**
 * Pad `src` with white/opaque pixels to reach (targetW × targetH).
 *
 * When baseline and current have different page heights (e.g. content was added
 * or removed) pixelmatch requires matching dimensions. We pad the shorter image
 * with white rather than stretching/cropping, so the height difference itself
 * shows as a visual change in the diff (new white pixels where content used to be).
 */
function padToSize(src, targetW, targetH) {
  if (src.width === targetW && src.height === targetH) return src;

  const dst = new PNG({ width: targetW, height: targetH });

  // Fill destination with opaque white
  for (let i = 0; i < dst.data.length; i += 4) {
    dst.data[i]     = 255; // R
    dst.data[i + 1] = 255; // G
    dst.data[i + 2] = 255; // B
    dst.data[i + 3] = 255; // A (fully opaque)
  }

  // Copy source pixels into the top-left corner of the destination
  PNG.bitblt(
    src, dst,
    0, 0,
    Math.min(src.width,  targetW),
    Math.min(src.height, targetH),
    0, 0
  );

  return dst;
}

/**
 * Compare two PNG files and write a diff image.
 * Returns { diffPixels, totalPixels, diffPercent, width, height }.
 */
function compareImages(baselinePath, currentPath, diffPath) {
  let base = readPng(baselinePath);
  let curr = readPng(currentPath);

  // Normalise to the larger of the two dimensions
  const w = Math.max(base.width,  curr.width);
  const h = Math.max(base.height, curr.height);

  base = padToSize(base, w, h);
  curr = padToSize(curr, w, h);

  const diff = new PNG({ width: w, height: h });

  const diffPixels = pixelmatch(
    base.data,
    curr.data,
    diff.data,
    w, h,
    {
      threshold:  config.diffThreshold,
      includeAA:  false, // ignore anti-aliasing sub-pixel shifts
    }
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = w * h;
  const diffPercent = (diffPixels / totalPixels) * 100;

  return { diffPixels, totalPixels, diffPercent, width: w, height: h };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log(`
┌─ EA Visual Regression ── Compare ─────────────────────────────
│  pixel threshold : ${config.diffThreshold}  (0 = exact, 1 = ignore all)
│  fail threshold  : >${config.failThreshold}% of pixels changed
│  viewports       : ${activeViewports.join(', ')}
└───────────────────────────────────────────────────────────────
`);

  const allResults = [];

  for (const viewport of activeViewports) {
    const baseDir = path.join(config.dirs.baseline, viewport);
    const currDir = path.join(config.dirs.current,  viewport);
    const diffDir = path.join(config.dirs.diff,     viewport);

    ensureDir(diffDir);

    // Guard: both directories must exist
    if (!fs.existsSync(baseDir)) {
      console.error(`Baseline directory missing: ${baseDir}`);
      console.error('Run `npm run baseline` first.\n');
      process.exit(1);
    }
    if (!fs.existsSync(currDir)) {
      console.error(`Current directory missing: ${currDir}`);
      console.error('Run `npm run current` first.\n');
      process.exit(1);
    }

    const baseFiles = fs.readdirSync(baseDir)
      .filter(f => f.endsWith('.png'))
      .sort();

    const currFileSet = new Set(
      fs.readdirSync(currDir).filter(f => f.endsWith('.png'))
    );

    if (!baseFiles.length) {
      console.error(`No PNG files in ${baseDir}. Did the baseline capture succeed?\n`);
      process.exit(1);
    }

    console.log(`── ${viewport} — comparing ${baseFiles.length} baseline images ─────────────────`);

    for (let i = 0; i < baseFiles.length; i++) {
      const filename    = baseFiles[i];
      const name        = filename.replace('.png', '');
      const baselinePath = path.join(baseDir, filename);
      const currentPath  = path.join(currDir, filename);
      const diffPath     = path.join(diffDir, filename);
      const idx          = `[${String(i + 1).padStart(String(baseFiles.length).length)}/${baseFiles.length}]`;

      const entry = {
        name,
        filename,
        viewport,
        // Store paths relative to project root so report.js can compute
        // the correct relative path from the report file's location
        baselinePath: path.relative(process.cwd(), baselinePath),
        currentPath:  path.relative(process.cwd(), currentPath),
        diffPath:     path.relative(process.cwd(), diffPath),
      };

      // ── Case 1: current screenshot is missing ──────────────────────────
      if (!currFileSet.has(filename)) {
        entry.status      = 'missing';
        entry.diffPercent = 100;
        entry.error       = 'Current screenshot not found — page may have been removed or capture failed.';
        console.log(`${idx} ⚠  MISSING  ${filename}`);
        allResults.push(entry);
        continue;
      }

      // ── Case 2: compare the two images ────────────────────────────────
      try {
        const { diffPercent, diffPixels, totalPixels, width, height } =
          compareImages(baselinePath, currentPath, diffPath);

        entry.diffPercent  = diffPercent;
        entry.diffPixels   = diffPixels;
        entry.totalPixels  = totalPixels;
        entry.dimensions   = `${width}×${height}`;
        entry.status       = diffPercent > config.failThreshold ? 'fail' : 'pass';

        const icon = entry.status === 'pass' ? '✓' : '✗';
        const pct  = diffPercent.toFixed(3).padStart(8);
        console.log(`${idx} ${icon}  ${entry.status.toUpperCase().padEnd(4)}  ${pct}%  ${filename}`);

      } catch (err) {
        entry.status      = 'error';
        entry.diffPercent = 100;
        entry.error       = err.message;
        console.error(`${idx} ✗  ERROR  ${filename}  —  ${err.message}`);
      }

      currFileSet.delete(filename); // mark as processed
      allResults.push(entry);
    }

    // ── Case 3: current screenshots with no matching baseline ──────────────
    // These are NEW pages added since the last baseline capture.
    for (const filename of currFileSet) {
      const name = filename.replace('.png', '');
      console.log(`      ★  NEW      ${filename}`);
      allResults.push({
        name,
        filename,
        viewport,
        currentPath: path.relative(process.cwd(), path.join(currDir, filename)),
        status:       'new',
        diffPercent:  0,
        note:         'No baseline exists for this page. Run `npm run baseline` to adopt it.',
      });
    }

    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = { pass: 0, fail: 0, missing: 0, error: 0, new: 0 };
  allResults.forEach(r => { if (r.status in counts) counts[r.status]++; });

  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  total   : ${allResults.length}`);
  console.log(`  ✓ pass  : ${counts.pass}`);
  console.log(`  ✗ fail  : ${counts.fail}`);
  console.log(`  ⚠ miss  : ${counts.missing}`);
  console.log(`  ★ new   : ${counts.new}`);
  if (counts.error) console.log(`  ! error : ${counts.error}`);

  // ── Save results.json ─────────────────────────────────────────────────────
  ensureDir(config.dirs.reports);
  const resultsPath = path.join(config.dirs.reports, 'results.json');

  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: {
      diffThreshold: config.diffThreshold,
      failThreshold: config.failThreshold,
      viewports:     activeViewports,
    },
    summary: {
      total:   allResults.length,
      pass:    counts.pass,
      fail:    counts.fail,
      missing: counts.missing,
      error:   counts.error,
      new:     counts.new,
    },
    results: allResults,
  }, null, 2));

  console.log(`\nResults saved → ${resultsPath}`);
  console.log('Run `npm run report` to generate the HTML report.\n');

  // Exit non-zero so CI can catch regressions
  if (counts.fail > 0 || counts.missing > 0) process.exit(1);
}

main();
