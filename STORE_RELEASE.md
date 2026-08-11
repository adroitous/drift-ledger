# Drift Ledger Store Release

## Distribution Path

Drift Ledger is Brave-specific, but Brave installs compatible extensions from the Chrome Web Store. The release target is therefore one Chrome Web Store listing whose copy clearly says **Brave Desktop on Windows**.

Official references:

- Brave extension installation: https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave
- Prepare and ZIP an extension: https://developer.chrome.com/docs/webstore/prepare
- Publish workflow: https://developer.chrome.com/docs/webstore/publish
- Store image requirements: https://developer.chrome.com/docs/webstore/images
- Privacy dashboard fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- User data policy: https://developer.chrome.com/docs/webstore/user_data

## Release Package

Run:

```powershell
.\tools\package-release.ps1
```

The generated ZIP contains only `manifest.json`, `src/`, and `icons/`, with the manifest at the archive root. It excludes tests, reports, historical imports, browser databases, private keys, dependencies, and unrelated workspace files.

## Listing Draft

**Name:** Drift Ledger

**Summary:** Local Brave time analytics, attention-drift patterns, site averages, and focus sessions.

**Category:** Productivity

**Description:**

Drift Ledger measures active foreground browsing time by domain in Brave Desktop. It groups activity into browsing blocks and uses visible, configurable thresholds to flag long feed, video, sports, and game-stat loops.

The popup shows the current block, top domains, navigation count, drift mix, focus timer, and today's category totals. The dashboard adds daily and hourly charts, site and session averages, period comparisons, browsing-block review, deterministic pattern notes, CSV and JSON export, and a separately labeled historical estimate. You can pause tracking, snooze a reminder, mark a block as intentional, configure local categories and budgets, or start a local focus session.

All processing stays on the device. Drift Ledger does not collect page content, full URLs, search terms, form input, cookies, or incognito activity. It has no account, analytics, advertising, cloud sync, or remote API calls.

## Privacy Dashboard Draft

**Single purpose:** Measure active Brave browsing time by domain and show local browsing-block summaries and attention-drift indicators.

**Data disclosure:** Select web history/browsing activity. Domain names, active-time aggregates, navigation counts, and local session summaries are processed and stored locally for the extension's user-facing functionality. No data is transmitted.

**Remote code:** No. All executable code is included in the extension package.

**Limited use:** Certify that browsing data is used only for the disclosed user-facing functionality, is not sold or transferred, is not used for advertising or credit decisions, and is not read by the developer.

**Privacy policy URL:** https://github.com/adroitous/drift-ledger/blob/main/PRIVACY.md

## Permission Justifications

| Permission | Justification |
| --- | --- |
| `alarms` | Settles active-time counters and evaluates the current block once per minute while the Manifest V3 worker is suspended between events. |
| `idle` | Excludes time when the user is away from the machine. |
| `notifications` | Shows configurable local reminders when a browsing block crosses a drift threshold. |
| `storage` | Stores settings, domain-level aggregates, and optional history baselines locally on the device. |
| `tabs` | Identifies the active tab's domain and whether its Brave window is focused. |
| `webNavigation` | Counts top-frame page loads and same-page route changes used by the transparent drift heuristic. |

The extension requests no host permissions and injects no content scripts.

## Required Listing Assets

- Included: 128x128 extension icon with transparent padding.
- Needed before submission: at least one full-bleed product screenshot at 1280x800 or 640x400.
- Needed before submission: one 440x280 small promotional image.
- Optional: up to five screenshots and a 1400x560 marquee image.

Screenshots must show the real popup/options experience and must not expose the user's actual browsing history. Use a clean temporary Brave profile with synthetic data.

## Publisher Checklist

1. Register a Chrome Web Store developer account and pay the one-time registration fee.
2. Verify the publisher email and enable 2-Step Verification.
3. Publish the source repository and use its `PRIVACY.md` page as the privacy-policy URL.
4. Run tests, syntax checks, the package script, and a clean-profile Brave smoke test.
5. Create the required screenshot and promotional image without personal data.
6. Upload the ZIP in the Chrome Web Store Developer Dashboard.
7. Complete Store Listing, Privacy, Distribution, and test-instructions fields.
8. Submit with deferred publishing, review the approved listing, then publish.

New extensions and permissions involving browsing activity may receive additional review. Do not claim that the extension blocks distraction or diagnoses a condition; its behavior is measurement and user-controlled nudging.
