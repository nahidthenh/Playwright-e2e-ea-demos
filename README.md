# Essential Addons Demos — Automated Regression Testing

Automated DOM regression tests for [Essential Addons](https://essential-addons.com) demo pages using Playwright. Detects structural/UI changes across 127+ widget pages after every plugin update.

---

## How It Works

1. Playwright visits each URL from `urls.txt`
2. Waits for Elementor to finish rendering
3. Dismisses cookie banners, hides dynamic noise (countdown timers, NotificationX popups, header/footer)
4. Captures the **ARIA accessibility tree** of the page body as a `.txt` snapshot
5. On future runs, compares the current tree against the baseline — any structural change fails the test

**Why ARIA snapshots?** They capture semantic structure (headings, buttons, links, regions) but ignore CSS classes, nonces, asset hashes, and inline styles. This means zero false positives from implementation changes, and diffs that clearly show *what* changed.

---

## Folder Structure

```
essential-addons-demos-automation/
├── urls.txt                        # 127+ demo page URLs (one per line)
├── playwright.config.js            # Parallel config, desktop + mobile projects
├── package.json
├── .github/
│   └── workflows/
│       └── regression.yml          # GitHub Actions CI pipeline
├── tests/
│   └── regression.spec.js          # Main test file (parametrized by URL)
├── utils/
│   ├── readUrls.js                 # Reads and parses urls.txt
│   ├── nameHelper.js               # URL → unique test/snapshot name
│   └── domCleaner.js               # CSS noise filter reference
└── snapshots/
    └── desktop/
        └── tests/regression.spec.js/
            ├── elementor--advanced-tabs.txt
            ├── elementor--countdown.txt
            └── ...                 # One .txt file per URL
```

---

## Setup

**Requirements:** Node.js 18+

```bash
# 1. Clone the repo
git clone https://github.com/your-org/essential-addons-demos-automation.git
cd essential-addons-demos-automation

# 2. Install dependencies
npm install

# 3. Install Playwright browser (Chromium only)
npx playwright install chromium --with-deps
```

---

## Running Tests

### Compare against baselines
```bash
npx playwright test
```
Runs all 128 tests in parallel. Fails if any widget's structure changed since the last baseline.

### Desktop only
```bash
npx playwright test --project=desktop
```

### Mobile only
```bash
npx playwright test --project=mobile
```

### Single widget
```bash
npx playwright test --grep "elementor--advanced-tabs"
```

### Filter by keyword (e.g. all WooCommerce widgets)
```bash
URL_FILTER=woo npx playwright test
```

### View HTML report after a run
```bash
npx playwright show-report
```

---

## Baseline Management

### Generate baselines (first time or full refresh)
```bash
npx playwright test --project=desktop --update-snapshots
```
Creates a `.txt` snapshot file for every URL. Commit these files — they are the source of truth for future comparisons.

### Update a single widget after an intentional change
```bash
npx playwright test --project=desktop --update-snapshots --grep "elementor--advanced-tabs"
```

### Update all baselines after a major release
```bash
npx playwright test --update-snapshots
```

> **Commit the updated snapshots** so the next CI run compares against the new baseline:
> ```bash
> git add snapshots/
> git commit -m "chore: update regression snapshots after v6.x release"
> git push
> ```

---

## Adding or Removing URLs

Edit `urls.txt` — one URL per line. Lines starting with `#` are treated as comments and skipped.

```
# New widgets added in v6.x
https://essential-addons.com/elementor/new-widget/
```

After adding URLs, generate baselines for the new ones:
```bash
npx playwright test --project=desktop --update-snapshots --grep "new-widget"
```

---

## GitHub Actions

The workflow at [.github/workflows/regression.yml](.github/workflows/regression.yml) runs automatically on:

| Trigger | Behaviour |
|---|---|
| Every Monday 08:00 UTC | Compares against committed baselines |
| Manual dispatch | Choose to compare OR update baselines |

### Manual dispatch options

Go to **Actions → EA Demo Regression Tests → Run workflow**:

| Input | Description |
|---|---|
| `update_snapshots` | Set to `yes` to regenerate all baselines and auto-commit them |
| `url_filter` | Optional substring filter e.g. `woo` to run only WooCommerce widgets |

When `update_snapshots=yes`, the bot automatically commits the new snapshots back to the repo with `[skip ci]` so it doesn't trigger another run.

### Artifacts

After every run, two artifacts are uploaded:

- `playwright-report-desktop` — Full HTML report (30 day retention)
- `snapshot-diffs-desktop` — Diff files on failure (14 day retention)

---

## Understanding a Failure

When a test fails, the output shows exactly what changed:

```
Error: Snapshot comparison failed:

  - heading "Advanced Tabs" [level=2]          ✓ matches
  - text: "EA Advanced Tab will let you..."    ✓ matches
- - link "Documentation"                       ✗ missing in current
+ + link "Docs"                                ✗ new in current
```

This means the "Documentation" link was renamed to "Docs" — a real change caught by the regression test.

**If the change is intentional:** update the baseline for that widget.
**If the change is unexpected:** investigate the plugin update that caused it.

---

## Snapshot Noise Filters

The following dynamic elements are hidden before snapshotting to prevent false positives:

| Element | Why hidden |
|---|---|
| Site header & footer | Navigation changes don't indicate widget regressions |
| NotificationX popups | Random sales/FOMO notifications change on every load |
| Countdown timers | Days/Hours/Mins/Secs tick every second |
| Seasonal promo banners | Campaign-specific content unrelated to widget functionality |
| WP admin bar | Only visible when logged in |

---

## Troubleshooting

**Test times out on a specific page**
Some pages (especially heavy Facebook embed or WooCommerce pages) occasionally exceed the 60s timeout due to server load. Retry:
```bash
npx playwright test --project=desktop --update-snapshots --grep "facebook-feed"
```

**Snapshot is empty / 0 bytes**
Make sure CSS selectors in the `addStyleTag` block don't accidentally match the `<body>` element. The known pitfall: `[class*="notificationx"]` matches `body.has-notificationx`. Always use exact class names for third-party plugins.

**Too many false positives after a run**
A dynamic element is leaking into snapshots. Identify the element from the diff, add its exact CSS class to the `addStyleTag` block in [tests/regression.spec.js](tests/regression.spec.js), then regenerate baselines.

**Want to run only failed tests from the last run**
```bash
npx playwright test --last-failed
```
