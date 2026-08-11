import test from "node:test";
import assert from "node:assert/strict";

import { callExtensionApi } from "../src/chromeCompat.js";

test("supports legacy callback-only extension APIs", async () => {
  globalThis.chrome = { runtime: {} };
  const legacyApi = {
    queryState(_seconds, callback) {
      queueMicrotask(() => callback("active"));
    }
  };

  assert.equal(await callExtensionApi(legacyApi, "queryState", 60), "active");
  delete globalThis.chrome;
});

test("supports current Promise-returning extension APIs", async () => {
  globalThis.chrome = { runtime: {} };
  const currentApi = {
    queryState() {
      return Promise.resolve("idle");
    }
  };

  assert.equal(await callExtensionApi(currentApi, "queryState", 60), "idle");
  delete globalThis.chrome;
});

test("turns runtime.lastError into a rejected Promise", async () => {
  globalThis.chrome = { runtime: {} };
  const failingApi = {
    get(_tabId, callback) {
      queueMicrotask(() => {
        globalThis.chrome.runtime.lastError = { message: "Tab is unavailable" };
        callback();
        delete globalThis.chrome.runtime.lastError;
      });
    }
  };

  await assert.rejects(
    callExtensionApi(failingApi, "get", 42),
    /Tab is unavailable/
  );
  delete globalThis.chrome;
});
