/**
 * global-setup.ts
 *
 * Runs once before the workers start: discovers all demo-page URLs and
 * writes them to smoke-results/urls.json, which smoke.spec.ts reads to
 * generate one test per page.
 */

import * as fs from 'fs';
import * as path from 'path';
import { discoverDemoPages } from './discover';

export const RESULTS_DIR = path.resolve(__dirname, '..', 'smoke-results');
export const URLS_FILE = path.join(RESULTS_DIR, 'urls.json');
export const PAGES_DIR = path.join(RESULTS_DIR, 'pages');

export default async function globalSetup() {
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });

  const { pages, warnings } = await discoverDemoPages();
  fs.writeFileSync(
    URLS_FILE,
    JSON.stringify({ discoveredAt: new Date().toISOString(), warnings, pages }, null, 2),
  );

  console.log(`[smoke] discovered ${pages.length} demo pages (source: ${pages[0].source})`);
  for (const w of warnings) console.log(`[smoke] discovery warning: ${w}`);
}
