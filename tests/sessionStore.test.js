import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  createEmptyState,
  creditActivity,
  localDateKey,
  recordNavigation
} from "../src/sessionStore.js";

test("records active seconds and navigations as separate aggregate signals", () => {
  const now = new Date(2026, 7, 10, 12, 0, 0).getTime();
  const state = createEmptyState(now);
  const activity = { domain: "reddit.com", category: "social" };

  recordNavigation(state, activity.domain, activity.category, now, DEFAULT_SETTINGS);
  creditActivity(state, activity, 60, now + 60000, DEFAULT_SETTINGS);

  const day = state.daily[localDateKey(now)];
  assert.equal(day.totalActiveSeconds, 60);
  assert.equal(day.domains["reddit.com"].visits, 1);
  assert.equal(day.domains["reddit.com"].sessions, 1);
  assert.equal(state.currentBlock.navigations, 1);
});

test("deduplicates route and commit events emitted for one navigation", () => {
  const now = Date.now();
  const state = createEmptyState(now);
  recordNavigation(state, "youtube.com", "video", now, DEFAULT_SETTINGS);
  recordNavigation(state, "youtube.com", "video", now + 200, DEFAULT_SETTINGS);
  recordNavigation(state, "youtube.com", "video", now + 2000, DEFAULT_SETTINGS);
  assert.equal(state.currentBlock.navigations, 2);
});

test("starts a new block after the configured inactivity gap", () => {
  const now = Date.now();
  const state = createEmptyState(now);
  const activity = { domain: "youtube.com", category: "video" };
  creditActivity(state, activity, 60, now, DEFAULT_SETTINGS);
  const firstId = state.currentBlock.id;

  creditActivity(state, activity, 60, now + 31 * 60 * 1000, DEFAULT_SETTINGS);
  assert.notEqual(state.currentBlock.id, firstId);
  assert.equal(state.archivedBlocks.length, 1);
});
