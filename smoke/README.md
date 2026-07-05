# EA Demo Smoke Test

Automated post-deploy smoke test for the ~110 Elementor widget/extension demo
pages on [essential-addons.com](https://essential-addons.com). After every
plugin release, it crawls every demo page in headless Chromium and **fails the
build** on:

- 🐘 **PHP errors** — fatal/parse errors, warnings/notices/deprecations,
  WordPress "critical error" pages, white screens
- 🟨 **JS errors** — uncaught exceptions and first-party `console.error`
- 🌐 **Network failures** — 4xx/5xx or failed requests for first-party
  (essential-addons.com / wpdeveloper.com) CSS/JS/images/AJAX
- 🧩 **Broken rendering** — no Elementor widgets, or the page's primary
  widget missing/empty

Third-party marketing noise (pixels, analytics) and the site's always-on
campaigns (exit-intent popups, countdowns, promo banners) are **warnings
only** — see [The ignore layer](#the-ignore-layer-ignore-configts).

## Running

**GitHub Actions:** *Actions → EA Demo Smoke Test → Run workflow* (optionally
tune concurrency / base URL). It also fires automatically when your deploy
pipeline sends a `repository_dispatch` event of type `plugin-deployed` — see
the comment in `.github/workflows/demo-smoke-test.yml`.

**Locally:**

```bash
npm ci
npx playwright install chromium
npm run smoke                    # full crawl (~110 pages, a few minutes)
npx playwright test --config=playwright.smoke.config.ts -g advanced-search   # one page
npm run smoke:report             # open the HTML report
```

Environment overrides: `SMOKE_CONCURRENCY` (default 8), `SMOKE_RETRIES` (1),
`SMOKE_BASE_URL`, `SMOKE_NAV_TIMEOUT`, `SMOKE_TEST_TIMEOUT`.

Output lands in `smoke-results/` (`summary.json`, `summary.md`, per-page JSON
in `pages/`) and `smoke-report/` (Playwright HTML report). In CI both are
uploaded as the `smoke-test-results` artifact, failures/warnings appear as
inline annotations, and a grouped report is written to the run's step summary.

## How URL discovery works (`discover.ts`)

Nothing is hardcoded. Every demo page embeds the server-rendered **"Elements
Panel"** off-canvas, whose grid links every demo as
`https://essential-addons.com/elementor/<slug>/` — that is the primary source
(malformed hrefs with trailing `%20` are normalized, duplicates removed). The
**sitemap** can't be the primary source on this site — demo pages live at
root-level slugs indistinguishable from marketing pages — so it's used as a
cross-check instead: panel links missing from the sitemap are reported as
warnings. If the panel scrape breaks entirely, the crawl falls back to the
repo's static `urls.txt`.

## The ignore layer (`ignore-config.ts`)

**Everything the suite deliberately ignores lives in this one file.** The site
permanently runs marketing campaigns; update this file each season instead of
touching test logic:

| What changed | What to edit |
|---|---|
| New seasonal popup / banner / notice bar | Add its CSS selector to `CAMPAIGN_SELECTORS` |
| New marketing pixel spamming the console | Add a regex to `CONSOLE_IGNORE_PATTERNS` |
| New tracking domain with failing requests | Add the host to `THIRD_PARTY_IGNORE_HOSTS` |
| First-party campaign asset 404s (e.g. exit-intent image) should warn, not fail | Add a regex to `FIRST_PARTY_WARN_ONLY_PATTERNS` |
| A panel link should not be crawled at all | Add its slug to `SKIP_SLUGS` |

Classification rules:

- Requests to `essential-addons.com` / `wpdeveloper.com` are **first-party**:
  failures on them **fail the build** (unless matched by
  `FIRST_PARTY_WARN_ONLY_PATTERNS`). Everything else is third-party → warning,
  and hosts in `THIRD_PARTY_IGNORE_HOSTS` are silently dropped.
- `console.error` from a third-party script URL, or matching
  `CONSOLE_IGNORE_PATTERNS`, is a warning. Uncaught exceptions whose stack
  points only at third-party hosts are warnings.
- Elements inside `CAMPAIGN_SELECTORS` containers (popups, countdown wrappers,
  promo bars…) are excluded from all rendering assertions — countdown values
  change every load and are never asserted on.

## Mapping widgets (`widget-map.ts`)

Each demo page asserts that its **primary widget** is present and non-empty.
The selector is resolved as:

1. `WIDGET_OVERRIDES[slug]` — explicit selector (e.g. `advanced-tabs` →
   `.elementor-widget-eael-adv-tabs`)
2. Auto-derived `.elementor-widget-eael-<slug>` — a missing widget **fails**
   only for slugs in `VERIFIED_AUTO` (verified against the live site);
   for unknown/new slugs it's a **warning** prompting you to map them
3. Slugs in `GENERIC_ONLY` (extension demos like `scroll-to-top`, panel footer
   links like `docs`) get only the generic "≥1 non-empty `.elementor-widget`"
   check

**Adding a new demo page:** usually nothing to do — the panel link is
discovered automatically and rule 2 covers the widget. If the run warns
`Expected primary widget not found … unverified auto-derived selector`, open
the page, inspect the widget wrapper (`<div class="… elementor-widget-eael-XYZ
…">`), then either add the slug to `VERIFIED_AUTO` (class matches the slug) or
add one line to `WIDGET_OVERRIDES`. Extension demos with no widget markup go
in `GENERIC_ONLY`.

## debug.log scanning (not active yet)

Some PHP errors are written to `wp-content/debug.log` but suppressed
on-screen. The workflow contains a clearly marked **stub step** (`if: false`)
that fetches and greps the server's debug.log — enable it once SSH access to
the demo server exists (instructions are in the workflow file).

## File map

```
smoke/
├── ignore-config.ts    ← campaign/third-party ignore layer — EDIT THIS each campaign
├── widget-map.ts       ← slug → primary-widget selector mapping
├── discover.ts         ← runtime URL discovery (panel → sitemap check → urls.txt)
├── checks.ts           ← PHP-error patterns + in-browser rendering checks
├── smoke.spec.ts       ← one Playwright test per discovered page
├── global-setup.ts     ← runs discovery, writes smoke-results/urls.json
└── global-teardown.ts  ← summary.json, $GITHUB_STEP_SUMMARY, ::error/::warning
playwright.smoke.config.ts   ← runner config (workers, retries, timeouts)
.github/workflows/demo-smoke-test.yml
```
