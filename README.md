# Drift Ledger

Drift Ledger is a local-only Manifest V3 extension for Brave Desktop on Windows. It measures active foreground time by domain, groups activity into browsing blocks, calculates site and session averages, reveals daily and hourly patterns, and uses transparent thresholds to flag long feed, video, sports, news, shopping, and game-stat loops.

It does not collect page content, raw URLs, search terms, form inputs, or incognito activity. Data stays in `chrome.storage.local` and is retained for 30 days by default.

The extension requests access to tabs, navigation events, idle state, local storage, alarms, and notifications. It does not request permission to read or change page content.

The compatibility floor is a Brave build based on Chromium 92 or newer. Extension API calls use the legacy callback contract as well as current Promise behavior so the idle, tab, storage, badge, and notification paths work across that range.

## Dashboard

The full dashboard provides:

- Seven, 30, and 90-day measured reports.
- Daily and hourly activity distributions.
- Site totals, visits, sessions, average visit time, average session time, and longest session.
- Category allocation, drift share, daily-budget consistency, period comparisons, and deterministic pattern notes.
- Browsing-block review with risk, navigations, duration, and top domains.
- Local focus sessions with toolbar countdowns and completion notifications.
- CSV site reports and privacy-safe JSON backup exports.
- A separately labeled historical Brave estimate that is never mixed into measured totals.

Classification generalizes through explicit category roles: drift, neutral, and supportive. Built-in rules cover common domains, while local domain overrides let the user correct classifications without an AI service or remote data transfer.

## Historical Continuity

Existing Brave history can be imported as an estimated baseline without mixing it into live measured counters.

1. Open the extension options page.
2. Under **Brave history baseline**, select the generated JSON file.
3. Choose **Import Brave history**.

The import contains Brave-only daily totals, domain totals, visit and session counts, per-site averages, categories, and historical drift blocks. It excludes other browsers, full URLs, titles, search queries, and page content. Exported extension data preserves the baseline's `estimated` label and coverage window.

To rebuild the baseline from another saved Brave `History` database:

```powershell
python .\tools\build_brave_history_import.py `
  --history "C:\path\to\Brave\History" `
  --start "2026-07-27T16:11:53-04:00" `
  --end "2026-08-10T16:11:53-04:00" `
  --output "C:\path\to\brave-history-import.json"
```

## Install In Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `drift-ledger` source folder.
5. Pin **Drift Ledger** from the extensions menu.
6. Open **Dashboard** from the popup for the complete application.

No build step is required. After source changes, use **Reload** on `brave://extensions`.

## Behavior

- Active time counts only when Brave is focused, the tab is active, and the machine is not idle.
- A browsing block ends after 30 minutes without counted activity.
- Medium risk defaults to 45 active minutes, at least 60% drift-category time, and at least 30 navigations.
- High risk defaults to 90 active minutes, at least 75% drift-category time, and either 40 navigations per hour or a recurring top-domain loop.
- Coding, learning, and work sites are not treated as drift by default.
- The daily drift budget, retention period, default focus duration, and local notifications are configurable.

All thresholds and domain overrides are available from the extension options page.

## Verify

```powershell
npm test
npm run check
npm run smoke:brave
.\tools\package-release.ps1
```

`npm run smoke:brave` launches the installed Brave executable with an isolated temporary profile. It loads the unpacked extension, checks its service worker, popup, options, settings persistence, legacy history import, rejection behavior, export privacy, and responsive overflow. It saves privacy-safe screenshots under `artifacts/brave-smoke/` and removes the temporary profile afterward. It never reads or modifies the everyday Brave profile.

Use `npm run verify:brave` to run the unit, syntax, and real-Brave smoke checks together. The extension popup provides the current block and today's measured category totals. The options page shows the imported historical baseline separately and supports local JSON export and full data clearing.

The release script creates an ignored, source-only ZIP under `release/`. Store submission notes and draft listing copy are in [`STORE_RELEASE.md`](STORE_RELEASE.md).
