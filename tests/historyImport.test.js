import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeBraveHistoryImport } from "../src/historyImport.js";

function validPayload() {
  return {
    schema: "drift-ledger-brave-history-v1",
    id: "brave-test",
    browser: "Brave",
    profile: "Default",
    generatedAt: "2026-08-10T16:30:00-04:00",
    coverage: {
      start: "2026-07-27T16:11:53-04:00",
      end: "2026-08-10T16:11:53-04:00"
    },
    methodology: {
      inferenceCapSeconds: 600,
      sessionGapSeconds: 1800,
      recordedContributionSeconds: 100,
      inferredContributionSeconds: 20,
      fullUrlsStored: false,
      searchQueriesStored: false,
      pageContentStored: false
    },
    totals: { sessions: 1 },
    daily: {
      "2026-08-10": {
        estimatedActiveSeconds: 120,
        visits: 2,
        domains: {
          "www.reddit.com": {
            category: "social",
            estimatedActiveSeconds: 120,
            visits: 2,
            sessions: 1,
            maxSessionSeconds: 120,
            url: "https://reddit.com/private-path"
          }
        },
        categories: { social: 120 },
        drift: { estimatedSeconds: 120, share: 1, mediumBlocks: 0, highBlocks: 0 }
      }
    },
    sites: {},
    driftBlocks: []
  };
}

test("sanitizes a Brave history baseline and recomputes totals", () => {
  const result = sanitizeBraveHistoryImport(validPayload());
  assert.equal(result.schema, "drift-ledger-brave-history-v1");
  assert.equal(result.browser, "Brave");
  assert.equal(result.totals.estimatedActiveSeconds, 120);
  assert.equal(result.totals.visits, 2);
  assert.equal(result.daily["2026-08-10"].domains["reddit.com"].url, undefined);
});

test("migrates the legacy history schema without dropping its aggregates", () => {
  const legacy = validPayload();
  legacy.schema = "attention-monitor-brave-history-v1";

  const result = sanitizeBraveHistoryImport(legacy);

  assert.equal(result.schema, "drift-ledger-brave-history-v1");
  assert.equal(result.totals.estimatedActiveSeconds, 120);
  assert.equal(result.daily["2026-08-10"].domains["reddit.com"].visits, 2);
});

test("rejects non-Brave or privacy-unsafe history", () => {
  const firefox = validPayload();
  firefox.browser = "Firefox";
  assert.throws(() => sanitizeBraveHistoryImport(firefox), /Only Brave/);

  const unsafe = validPayload();
  unsafe.methodology.fullUrlsStored = true;
  assert.throws(() => sanitizeBraveHistoryImport(unsafe), /exclude URLs/);
});
