import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalyticsReport } from "../src/analytics.js";
import { DEFAULT_SETTINGS, createEmptyState, creditActivity, recordNavigation } from "../src/sessionStore.js";

test("builds period totals, site averages, drift share, and hourly distribution", () => {
  const now = new Date(2026, 7, 11, 14, 0, 0).getTime();
  const state = createEmptyState(now);
  const activity = { domain: "reddit.com", category: "social" };
  recordNavigation(state, activity.domain, activity.category, now, DEFAULT_SETTINGS);
  creditActivity(state, activity, 600, now, DEFAULT_SETTINGS);

  const report = buildAnalyticsReport(state, DEFAULT_SETTINGS, { days: 7, now });

  assert.equal(report.summary.totalSeconds, 600);
  assert.equal(report.summary.driftSeconds, 600);
  assert.equal(report.sites[0].name, "reddit.com");
  assert.equal(report.sites[0].averageSecondsPerVisit, 600);
  assert.equal(report.hourly.find((entry) => entry.hour === "14").seconds, 600);
});

test("keeps estimated history separate from measured period totals", () => {
  const now = Date.now();
  const state = createEmptyState(now);
  state.historyBaseline = {
    coverage: { start: "2026-07-01T00:00:00Z", end: "2026-07-02T00:00:00Z" },
    totals: { estimatedActiveSeconds: 5000 },
    sites: { "example.com": { estimatedActiveSeconds: 5000 } }
  };

  const report = buildAnalyticsReport(state, DEFAULT_SETTINGS, { days: 7, now });

  assert.equal(report.summary.totalSeconds, 0);
  assert.equal(report.history.totals.estimatedActiveSeconds, 5000);
});

test("uses every retained block for summary metrics while limiting detail rows", () => {
  const now = Date.now();
  const state = createEmptyState(now);
  const block = (id, activeSeconds) => ({
    id,
    start: now,
    lastActiveAt: now,
    activeSeconds,
    navigations: 0,
    domainSeconds: {},
    categorySeconds: {},
    domainSequence: [],
    intentional: false
  });
  state.archivedBlocks = Array.from({ length: 100 }, (_, index) => block(`archived-${index}`, 10));
  state.currentBlock = block("current", 200);

  const report = buildAnalyticsReport(state, DEFAULT_SETTINGS, { days: 7, now });

  assert.equal(report.summary.sessions, 101);
  assert.equal(report.summary.longestBlockSeconds, 200);
  assert.equal(report.blocks.length, 100);
});
