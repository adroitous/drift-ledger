import test from "node:test";
import assert from "node:assert/strict";

import { scoreDrift } from "../src/driftScorer.js";
import { DEFAULT_SETTINGS } from "../src/sessionStore.js";

function block(overrides = {}) {
  return {
    activeSeconds: 0,
    navigations: 0,
    categorySeconds: {},
    domainSequence: [],
    intentional: false,
    snoozeUntil: 0,
    ...overrides
  };
}

test("scores sustained feed browsing as medium risk", () => {
  const result = scoreDrift(block({
    activeSeconds: 3000,
    navigations: 40,
    categorySeconds: { social: 1500, video: 600, coding: 900 }
  }), DEFAULT_SETTINGS);
  assert.equal(result.risk, "medium");
});

test("scores long high-navigation browsing as high risk", () => {
  const result = scoreDrift(block({
    activeSeconds: 6000,
    navigations: 90,
    categorySeconds: { social: 3000, video: 1800, other: 1200 }
  }), DEFAULT_SETTINGS);
  assert.equal(result.risk, "high");
});

test("does not label coding time or intentional blocks as drift", () => {
  const coding = scoreDrift(block({
    activeSeconds: 7200,
    navigations: 120,
    categorySeconds: { coding: 7200 }
  }), DEFAULT_SETTINGS);
  const intentional = scoreDrift(block({
    activeSeconds: 7200,
    navigations: 120,
    categorySeconds: { social: 7200 },
    intentional: true
  }), DEFAULT_SETTINGS);
  assert.equal(coding.risk, "low");
  assert.equal(intentional.risk, "low");
});
