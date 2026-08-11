import test from "node:test";
import assert from "node:assert/strict";

import { classifyDomain, normalizeDomain } from "../src/classifier.js";

test("normalizes URLs to a site-level domain without retaining paths", () => {
  assert.equal(normalizeDomain("https://www.reddit.com/r/test?token=secret"), "reddit.com");
  assert.equal(normalizeDomain("https://docs.example.co.uk/path"), "example.co.uk");
  assert.equal(normalizeDomain("brave://settings"), null);
});

test("classifies known sites and user overrides", () => {
  assert.equal(classifyDomain("www.youtube.com"), "video");
  assert.equal(classifyDomain("neetcode.io"), "coding");
  assert.equal(classifyDomain("example.com", { "example.com": "sports" }), "sports");
  assert.equal(classifyDomain("example.com"), "other");
});
