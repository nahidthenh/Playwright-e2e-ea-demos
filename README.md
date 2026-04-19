# Essential Addons Demos — Visual Regression Testing

Automated pixel-level visual regression tests for [Essential Addons](https://essential-addons.com) demo pages. Detects visual changes across 119+ widget pages after every plugin update by comparing full-page screenshots.

---

## How It Works

1. **Baseline** — Chromium captures full-page screenshots of every URL in `urls.txt` and saves them as the reference
2. **Compare** — After a plugin update, fresh screenshots are taken and compared pixel-by-pixel against the baseline using [pixelmatch](https://github.com/mapbox/pixelmatch)
3. **Report** — An interactive HTML report is published to GitHub Pages showing pass/fail per page with side-by-side diff images
4. **Notify** — Slack receives a per-page pass/fail summary via `playwright-slack-report`

---

## Folder Structure

```
essential-addons-demos-automation/
├── urls.txt                    # 119+ demo page URLs (one per line)
├── config.js                   # All tunable settings (thresholds, timeouts, selectors)
├── capture.js                  # Takes full-page screenshots
├── compare.js                  # Pixel-diffs baseline vs current, writes reports/results.json
├── report.js                   # Generates reports/report.html from results.json
├── package.json
├── playwright.config.js        # Playwright config (reporters including Slack)
├── .github/
│   └── workflows/
│       └── regression.yml      # GitHub Actions CI pipeline
├── tests/
│   └── regression.spec.js      # Converts results.json into Playwright tests for Slack reporting
├── screenshots/
│   ├── baseline/desktop/       # Reference screenshots (restored from cache on compare runs)
│   ├── current/desktop/        # Fresh screenshots captured during compare
│   └── diff/desktop/           # Highlighted diff images (red = changed pixels)
├── reports/
│   └── results.json            # Machine-readable comparison results
└── utils/
    ├── readUrls.js
    └── nameHelper.js
```

---

## Local Setup

**Requirements:** Node.js 20+

```bash
# 1. Clone the repo
git clone https://github.com/nahidthenh/Playwright-e2e-ea-demos.git
cd Playwright-e2e-ea-demos

# 2. Install dependencies
npm install

# 3. Install Chromium
npx playwright install chromium --with-deps
```

---

## Running Locally

### Step 1 — Capture baseline (before a plugin update)

```bash
npm run baseline
```

Saves screenshots to `screenshots/baseline/desktop/`.

### Step 2 — Deploy your plugin update, then capture current

```bash
npm run current
```

Saves screenshots to `screenshots/current/desktop/`.

### Step 3 — Compare

```bash
node compare.js
```

Diffs baseline vs current, writes diff images to `screenshots/diff/desktop/` and results to `reports/results.json`.

### Step 4 — View the HTML report

```bash
node report.js
open reports/report.html
```

---

## GitHub Actions

The workflow at [.github/workflows/regression.yml](.github/workflows/regression.yml) has two modes triggered manually or on a weekly schedule.

### One-time: Add repository secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-...`) from [api.slack.com/apps](https://api.slack.com/apps) |
| `SLACK_CHANNEL_ID` | Channel ID to post to (right-click channel in Slack → View channel details) |

> To get `SLACK_BOT_TOKEN`: create a Slack app → **OAuth & Permissions** → add scopes `chat:write` and `chat:write.public` → Install to Workspace → copy the Bot User OAuth Token.

### Running the workflow

Go to **Actions → EA Visual Regression → Run workflow**

#### Mode: `baseline`

Run this **before** deploying a plugin update to capture reference screenshots.

1. Go to **Actions → EA Visual Regression → Run workflow**
2. Select mode: `baseline`
3. Click **Run workflow**

The baseline screenshots are saved to the GitHub Actions cache and also uploaded as an artifact (`visual-regression-baseline`, 90-day retention) for manual download.

#### Mode: `compare`

Run this **after** deploying a plugin update to detect visual regressions.

1. Go to **Actions → EA Visual Regression → Run workflow**
2. Select mode: `compare` (or leave as default)
3. Click **Run workflow**

What happens:
- Restores baseline screenshots from cache
- Captures fresh screenshots of the live site
- Diffs them pixel-by-pixel
- Generates and publishes an HTML report to GitHub Pages
- Posts per-page pass/fail results to Slack

> **Important:** You must run `baseline` at least once before running `compare`. If no baseline exists in cache the compare run will fail at the restore step.

#### Weekly schedule

A `compare` run triggers automatically every **Monday at 08:00 UTC** to catch any unnoticed regressions.

---

## Tuning

All settings are in [config.js](config.js):

| Setting | Default | Description |
|---|---|---|
| `diffThreshold` | `0.1` | Per-pixel colour tolerance (0 = exact, 1 = ignore all) |
| `failThreshold` | `0.5` | % of changed pixels that marks a page as FAIL |
| `batchSize` | `2` on CI, `5` locally | Parallel Chromium pages (lower = less RAM) |
| `navigationTimeout` | `60000` ms | Hard timeout per page load |
| `settleDelay` | `2000` ms | Pause before screenshot to let animations finish |
| `maxScrollHeight` | `30000` px | Safety cap for infinite-scroll pages |
| `retries` | `2` | Retries per failing page |

### Adding or removing URLs

Edit `urls.txt` — one URL per line. Lines starting with `#` are comments.

```
# New widget added in v6.x
https://essential-addons.com/elementor/new-widget/
```

After adding new URLs, run a fresh `baseline` to include them.

### Hiding dynamic elements

Elements that change on every load (countdown timers, popups, live chat widgets) are hidden before capture via CSS. Add selectors to the `hideSelectors` array in `config.js`:

```js
hideSelectors: [
  '.your-dynamic-element',
  // ...
]
```

### Masking elements

Elements that should stay in the layout but be excluded from pixel comparison (e.g. a map or video canvas) go in `maskSelectors`. They are replaced with a solid rectangle in the screenshot:

```js
maskSelectors: [
  '.elementor-widget-eael-sphere-photo-viewer',
]
```

---

## Artifacts & Report

After a `compare` run:

| Artifact | Contents | Retention |
|---|---|---|
| `visual-regression-results` | `screenshots/diff/`, `screenshots/current/`, `reports/` | 30 days |
| `visual-regression-baseline` | `screenshots/baseline/` | 90 days |
| GitHub Pages | Interactive HTML report with diff images | Permanent |

The GitHub Pages report is published at:
`https://nahidthenh.github.io/Playwright-e2e-ea-demos/`

---

## Troubleshooting

**Capture hangs mid-run**
The runner ran out of memory. Lower `batchSize` in `config.js` or cancel and re-run — the workflow has a 30-minute timeout on capture steps.

**`fail-on-cache-miss` error on compare**
No baseline exists in cache. Run the workflow with mode `baseline` first.

**Too many false positives**
A dynamic element is leaking into screenshots. Identify it from the diff images in the report, add its CSS selector to `hideSelectors` in `config.js`, then re-run baseline.

**Slack notification not sent**
Verify `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` are set in repo secrets and that the bot has been added to the target channel (`/invite @your-bot-name`).
