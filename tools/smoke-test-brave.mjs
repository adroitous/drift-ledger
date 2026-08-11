import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const artifactRoot = resolve(projectRoot, "artifacts", "brave-smoke");

function findBrave() {
  const candidates = [
    process.env.BRAVE_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("Brave was not found. Set BRAVE_PATH to the Brave executable.");
  }
  return resolve(executable);
}

function loadPlaywright() {
  const moduleRoots = [
    join(projectRoot, "node_modules"),
    process.env.DRIFT_LEDGER_NODE_MODULES,
    join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules")
  ].filter(Boolean);

  for (const moduleRoot of moduleRoots) {
    const packageDirectory = join(resolve(moduleRoot), "playwright");
    const manifestPath = join(packageDirectory, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const runtimeRequire = createRequire(pathToFileURL(manifestPath));
    return {
      playwright: runtimeRequire(packageDirectory),
      version: JSON.parse(readFileSync(manifestPath, "utf8")).version
    };
  }

  throw new Error(
    "Playwright was not found. Run npm install --save-dev playwright, or set DRIFT_LEDGER_NODE_MODULES."
  );
}

function resetArtifactDirectory() {
  const expectedPrefix = `${projectRoot}${sep}`;
  if (!artifactRoot.startsWith(expectedPrefix)) {
    throw new Error("Refusing to clear an artifact directory outside the project.");
  }
  rmSync(artifactRoot, { recursive: true, force: true });
  mkdirSync(artifactRoot, { recursive: true });
}

function syntheticLegacyHistory() {
  return {
    schema: "attention-monitor-brave-history-v1",
    id: "brave-smoke-legacy",
    browser: "Brave",
    profile: "Synthetic smoke test",
    generatedAt: "2026-08-10T20:00:00-04:00",
    coverage: {
      start: "2026-08-09T20:00:00-04:00",
      end: "2026-08-10T20:00:00-04:00"
    },
    methodology: {
      inferenceCapSeconds: 600,
      sessionGapSeconds: 1800,
      recordedContributionSeconds: 120,
      inferredContributionSeconds: 0,
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
          "www.example.com": {
            category: "other",
            estimatedActiveSeconds: 120,
            visits: 2,
            sessions: 1,
            maxSessionSeconds: 120
          }
        },
        categories: { other: 120 },
        drift: { estimatedSeconds: 0, share: 0, mediumBlocks: 0, highBlocks: 0 }
      }
    },
    sites: {
      "www.example.com": {
        category: "other",
        estimatedActiveSeconds: 120,
        visits: 2,
        sessions: 1,
        maxSessionSeconds: 120,
        activeDays: 1,
        averageSecondsPerVisit: 60,
        averageSecondsPerSession: 120
      }
    },
    driftBlocks: []
  };
}

async function runtimeMessage(page, message) {
  return page.evaluate((payload) => new Promise((resolveMessage, rejectMessage) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        rejectMessage(new Error(chrome.runtime.lastError.message));
      } else {
        resolveMessage(response);
      }
    });
  }), message);
}

async function waitForExtensionWorker(context) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
    if (worker) {
      return worker;
    }
    await context.waitForEvent("serviceworker", { timeout: 2000 }).catch(() => undefined);
  }
  throw new Error("Drift Ledger's service worker did not start in Brave.");
}

async function startLocalPage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Drift Ledger smoke page</title><h1>Local smoke page</h1>");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/private-path?query=smoke-secret`
  };
}

async function main() {
  const bravePath = findBrave();
  const { playwright, version: playwrightVersion } = loadPlaywright();
  const profileRoot = mkdtempSync(join(tmpdir(), "drift-ledger-brave-"));
  const localPage = await startLocalPage();
  let context;

  resetArtifactDirectory();
  const extensionErrors = [];
  const attachPageDiagnostics = (page) => {
    page.on("pageerror", (error) => extensionErrors.push(`page: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        extensionErrors.push(`console: ${message.text()}`);
      }
    });
  };

  try {
    context = await playwright.chromium.launchPersistentContext(profileRoot, {
      executablePath: bravePath,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${projectRoot}`,
        `--load-extension=${projectRoot}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });
    context.on("page", attachPageDiagnostics);
    for (const page of context.pages()) {
      attachPageDiagnostics(page);
    }

    const worker = await waitForExtensionWorker(context);
    worker.on("console", (message) => {
      if (message.type() === "error") {
        extensionErrors.push(`service worker: ${message.text()}`);
      }
    });
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/src/options.html`);
    await optionsPage.locator("#mediumMinutes").waitFor({ state: "visible" });
    assert.equal(await optionsPage.locator("h1").innerText(), "Drift Ledger");

    let response = await runtimeMessage(optionsPage, { type: "CLEAR_DATA" });
    assert.equal(response.ok, true);
    response = await runtimeMessage(optionsPage, { type: "GET_SNAPSHOT" });
    assert.equal(response.ok, true);
    assert.equal(response.snapshot.settings.mediumMinutes, 45);

    await optionsPage.locator("#mediumMinutes").fill("50");
    await optionsPage.locator("#highMinutes").fill("95");
    await optionsPage.locator("#idleDetectionSeconds").fill("900");
    await optionsPage.locator("#overrideDomain").fill("example.com");
    await optionsPage.locator("#overrideCategory").selectOption("social");
    await optionsPage.locator("#addOverride").click();
    await optionsPage.getByRole("button", { name: "Save changes" }).click();
    await optionsPage.waitForFunction(() => document.querySelector("#saveStatus")?.textContent === "Saved");

    response = await runtimeMessage(optionsPage, { type: "GET_SNAPSHOT" });
    assert.equal(response.snapshot.settings.mediumMinutes, 50);
    assert.equal(response.snapshot.settings.highMinutes, 95);
    assert.equal(response.snapshot.settings.idleDetectionSeconds, 900);
    assert.equal(response.snapshot.settings.domainOverrides["example.com"], "social");

    const legacyHistory = syntheticLegacyHistory();
    response = await runtimeMessage(optionsPage, { type: "IMPORT_HISTORY", data: legacyHistory });
    assert.equal(response.ok, true);
    assert.equal(response.snapshot.history.totals.estimatedActiveSeconds, 120);

    const rejected = structuredClone(legacyHistory);
    rejected.browser = "Firefox";
    assert.deepEqual(extensionErrors, []);
    response = await runtimeMessage(optionsPage, { type: "IMPORT_HISTORY", data: rejected });
    assert.equal(response.ok, false);
    assert.match(response.error, /Only Brave/);
    await optionsPage.waitForTimeout(100);
    assert.ok(extensionErrors.length > 0);
    assert.ok(extensionErrors.every((message) => message.includes("Only Brave history can be imported")));
    extensionErrors.length = 0;

    await optionsPage.reload();
    await optionsPage.locator("#historySummary").waitFor({ state: "visible" });
    assert.equal(await optionsPage.locator("#historyTime").innerText(), "2m");
    assert.equal(await optionsPage.locator("#historyVisits").innerText(), "2");
    await optionsPage.screenshot({ path: join(artifactRoot, "options-1280x800.png") });

    const browsingPage = await context.newPage();
    await browsingPage.goto(localPage.url);
    await browsingPage.bringToFront();
    await browsingPage.waitForTimeout(500);

    const activeContext = await runtimeMessage(optionsPage, { type: "GET_SNAPSHOT" });
    const environmentalPause = ["idle", "locked", "browser_unfocused"].includes(
      activeContext.snapshot.pausedReason
    );
    if (!environmentalPause) {
      assert.equal(activeContext.snapshot.activity.domain, "127.0.0.1");
      await browsingPage.waitForTimeout(2200);
      const credited = await runtimeMessage(optionsPage, { type: "GET_SNAPSHOT" });
      assert.ok(credited.snapshot.today.activeDomainSeconds >= 1);
    }

    response = await runtimeMessage(optionsPage, { type: "EXPORT_DATA" });
    assert.equal(response.ok, true);
    assert.equal(response.data.historyBaseline.schema, "drift-ledger-brave-history-v1");
    const exportedText = JSON.stringify(response.data);
    assert.equal(exportedText.includes("private-path"), false);
    assert.equal(exportedText.includes("smoke-secret"), false);

    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 390, height: 700 });
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup.html`);
    await popupPage.locator("#activityStatus").waitFor({ state: "visible" });
    assert.equal(await popupPage.locator("h1").innerText(), "Drift Ledger");
    const popupOverflow = await popupPage.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert.ok(popupOverflow.scrollWidth <= popupOverflow.clientWidth);
    await popupPage.screenshot({ path: join(artifactRoot, "popup-390x700.png") });

    await browsingPage.close();
    await popupPage.close();
    await optionsPage.close();

    assert.deepEqual(extensionErrors, []);
    const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
    console.log(`PASS Drift Ledger ${manifest.version} on ${basename(bravePath)}`);
    console.log(`PASS extension service worker ${extensionId}`);
    console.log("PASS settings, legacy import, Brave-only rejection, export privacy, and popup layout");
    console.log(environmentalPause
      ? `INFO active-time credit skipped because Brave reported ${activeContext.snapshot.pausedReason}`
      : "PASS active domain timing on an isolated localhost page");
    console.log(`INFO Playwright ${playwrightVersion}`);
    console.log(`INFO screenshots ${artifactRoot}`);
  } finally {
    await context?.close().catch(() => undefined);
    await new Promise((resolveClose) => localPage.server.close(resolveClose));
    if (process.env.KEEP_BRAVE_SMOKE_PROFILE === "1") {
      console.log(`INFO retained temporary profile ${profileRoot}`);
    } else {
      const expectedTempPrefix = `${resolve(tmpdir())}${sep}`;
      if (!resolve(profileRoot).startsWith(expectedTempPrefix)) {
        throw new Error("Refusing to remove a profile outside the temporary directory.");
      }
      rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});
