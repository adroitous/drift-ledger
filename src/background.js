import { CATEGORY_DEFINITIONS, classifyDomain, normalizeDomain } from "./classifier.js";
import { buildAnalyticsReport } from "./analytics.js";
import { callExtensionApi } from "./chromeCompat.js";
import { scoreDrift } from "./driftScorer.js";
import { sanitizeBraveHistoryImport } from "./historyImport.js";
import {
  DEFAULT_SETTINGS,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  completeExpiredFocus,
  createEmptyState,
  creditActivity,
  hydrateState,
  pruneState,
  recordNavigation,
  sanitizeSettings,
  startFocusSession,
  stopFocusSession,
  todaySummary
} from "./sessionStore.js";

const TICK_ALARM = "drift-ledger-tick";
const FOCUS_ALARM = "drift-ledger-focus-end";
const MAX_CREDIT_SECONDS = 75;
const RISK_RANK = { low: 0, medium: 1, high: 2 };

let state;
let settings;
let loadPromise;
let operationQueue = Promise.resolve();
let legacyStorageNeedsCleanup = false;

function enqueue(operation) {
  operationQueue = operationQueue.then(operation, operation);
  operationQueue.catch((error) => console.error("Drift Ledger:", error));
  return operationQueue;
}

async function load() {
  if (!loadPromise) {
    loadPromise = callExtensionApi(
      chrome.storage.local,
      "get",
      [
        STORAGE_KEYS.settings,
        STORAGE_KEYS.state,
        LEGACY_STORAGE_KEYS.settings,
        LEGACY_STORAGE_KEYS.state
      ]
    )
      .then((stored) => {
        const storedSettings = stored[STORAGE_KEYS.settings] || stored[LEGACY_STORAGE_KEYS.settings];
        const storedState = stored[STORAGE_KEYS.state] || stored[LEGACY_STORAGE_KEYS.state];
        legacyStorageNeedsCleanup = Boolean(
          stored[LEGACY_STORAGE_KEYS.settings] || stored[LEGACY_STORAGE_KEYS.state]
        );
        settings = sanitizeSettings(storedSettings || DEFAULT_SETTINGS);
        state = hydrateState(storedState);
      });
  }
  await loadPromise;
}

async function save() {
  state.lastSavedAt = Date.now();
  pruneState(state, settings, state.lastSavedAt);
  await callExtensionApi(chrome.storage.local, "set", {
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.state]: state
  });
  if (legacyStorageNeedsCleanup) {
    await callExtensionApi(
      chrome.storage.local,
      "remove",
      [LEGACY_STORAGE_KEYS.settings, LEGACY_STORAGE_KEYS.state]
    );
    legacyStorageNeedsCleanup = false;
  }
}

async function configureRuntime() {
  chrome.idle.setDetectionInterval(settings.idleDetectionSeconds);
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (state.focusSession?.endsAt > Date.now()) {
    chrome.alarms.create(FOCUS_ALARM, { when: state.focusSession.endsAt });
  } else {
    await callExtensionApi(chrome.alarms, "clear", FOCUS_ALARM);
  }
}

function settleCurrentActivity(now = Date.now()) {
  const activity = state.activity;
  if (!activity?.counting || !activity.domain) {
    if (activity) {
      activity.lastTickAt = now;
    }
    return;
  }

  const elapsedSeconds = Math.max(0, (now - Number(activity.lastTickAt || now)) / 1000);
  const creditedSeconds = Math.min(elapsedSeconds, MAX_CREDIT_SECONDS);
  creditActivity(state, activity, creditedSeconds, now, settings);
  activity.lastTickAt = now;
}

function pauseActivity(reason, now = Date.now()) {
  state.activity = {
    domain: null,
    category: null,
    tabId: null,
    windowId: null,
    counting: false,
    lastTickAt: now
  };
  state.pausedReason = reason;
}

function beginActivity(context, now = Date.now()) {
  state.activity = {
    ...context,
    counting: true,
    lastTickAt: now
  };
  state.pausedReason = null;
}

async function contextForTab(tab, urlOverride) {
  if (!settings.trackingEnabled) {
    return { context: null, reason: "tracking_off" };
  }
  if (!tab || tab.incognito) {
    return { context: null, reason: tab?.incognito ? "incognito" : "no_active_tab" };
  }

  const idleState = await callExtensionApi(
    chrome.idle,
    "queryState",
    settings.idleDetectionSeconds
  );
  if (idleState !== "active") {
    return { context: null, reason: idleState };
  }

  let browserWindow;
  try {
    browserWindow = await callExtensionApi(chrome.windows, "get", tab.windowId);
  } catch {
    return { context: null, reason: "no_active_window" };
  }
  if (!browserWindow.focused || !tab.active) {
    return { context: null, reason: "browser_unfocused" };
  }

  const domain = normalizeDomain(urlOverride || tab.url);
  if (!domain) {
    return { context: null, reason: "unsupported_page" };
  }

  return {
    context: {
      domain,
      category: classifyDomain(domain, settings.domainOverrides),
      tabId: tab.id,
      windowId: tab.windowId
    },
    reason: null
  };
}

async function queryCurrentContext() {
  const tabs = await callExtensionApi(
    chrome.tabs,
    "query",
    { active: true, lastFocusedWindow: true }
  );
  const [tab] = tabs || [];
  return contextForTab(tab);
}

function topEntries(record = {}, count = 3) {
  return Object.entries(record)
    .map(([name, seconds]) => ({ name, seconds: Math.round(Number(seconds || 0)) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count);
}

function badgeText(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 1000) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}

async function updateBadge(scoring) {
  if (state.focusSession?.endsAt > Date.now()) {
    const remainingMinutes = Math.max(1, Math.ceil((state.focusSession.endsAt - Date.now()) / 60000));
    await callExtensionApi(chrome.action, "setBadgeBackgroundColor", { color: "#32705d" });
    await callExtensionApi(chrome.action, "setBadgeText", { text: `F${remainingMinutes}` });
    return;
  }
  if (!settings.trackingEnabled || scoring.risk === "low") {
    await callExtensionApi(chrome.action, "setBadgeText", { text: "" });
    return;
  }
  await callExtensionApi(chrome.action, "setBadgeBackgroundColor", {
    color: scoring.risk === "high" ? "#c84235" : "#bf7a16"
  });
  await callExtensionApi(
    chrome.action,
    "setBadgeText",
    { text: badgeText(scoring.activeSeconds) }
  );
}

async function evaluateAndNudge(now = Date.now()) {
  const block = state.currentBlock;
  const scoring = scoreDrift(block, settings, now);
  await updateBadge(scoring);

  if (!block || scoring.risk === "low" || !settings.notificationsEnabled) {
    return scoring;
  }
  if (RISK_RANK[scoring.risk] <= RISK_RANK[block.lastNotifiedRisk || "low"]) {
    return scoring;
  }

  const domainNames = topEntries(block.domainSeconds, 3).map((entry) => entry.name);
  const minutes = Math.round(scoring.activeSeconds / 60);
  const title = scoring.risk === "high" ? "Long browsing loop" : "Browsing block check-in";
  const message = `${minutes} active minutes${domainNames.length ? `: ${domainNames.join(", ")}` : ""}.`;

  try {
    await callExtensionApi(
      chrome.notifications,
      "create",
      `drift-${block.id}-${scoring.risk}`,
      {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      contextMessage: "Drift Ledger",
      buttons: [
        { title: "Remind in 15 minutes" },
        { title: "Mark intentional" }
      ],
      priority: scoring.risk === "high" ? 2 : 1
      }
    );
  } catch (error) {
    console.warn("Drift Ledger notification failed:", error);
  }
  block.lastNotifiedRisk = scoring.risk;
  return scoring;
}

async function completeFocusIfNeeded(now = Date.now()) {
  const completed = completeExpiredFocus(state, now);
  if (!completed) {
    return null;
  }
  await callExtensionApi(chrome.alarms, "clear", FOCUS_ALARM);
  if (settings.notificationsEnabled) {
    try {
      await callExtensionApi(chrome.notifications, "create", `focus-${completed.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Focus session complete",
        message: `${completed.label}: ${Math.round(completed.durationSeconds / 60)} minutes.`,
        contextMessage: "Drift Ledger"
      });
    } catch (error) {
      console.warn("Drift Ledger focus notification failed:", error);
    }
  }
  return completed;
}

async function syncActiveContext() {
  await load();
  const now = Date.now();
  await completeFocusIfNeeded(now);
  settleCurrentActivity(now);
  const { context, reason } = await queryCurrentContext();
  if (context) {
    beginActivity(context, now);
  } else {
    pauseActivity(reason, now);
  }
  await evaluateAndNudge(now);
  await save();
}

async function handleNavigation(details) {
  await load();
  if (details.frameId !== 0) {
    return;
  }

  const now = Date.now();
  settleCurrentActivity(now);
  let tab;
  try {
    tab = await callExtensionApi(chrome.tabs, "get", details.tabId);
  } catch {
    pauseActivity("no_active_tab", now);
    await save();
    return;
  }

  const { context, reason } = await contextForTab(tab, details.url);
  if (context) {
    beginActivity(context, now);
    recordNavigation(state, context.domain, context.category, now, settings);
  } else {
    pauseActivity(reason, now);
  }
  await evaluateAndNudge(now);
  await save();
}

function snapshot(now = Date.now()) {
  const day = todaySummary(state, now);
  const block = state.currentBlock;
  const scoring = scoreDrift(block, settings, now);
  const activeDomainTodaySeconds = state.activity?.domain
    ? Number(day.domains?.[state.activity.domain]?.activeSeconds || 0)
    : 0;
  const history = state.historyBaseline;
  const driftSecondsToday = Object.entries(day.categories || {})
    .filter(([category]) => CATEGORY_DEFINITIONS[category]?.role === "drift")
    .reduce((sum, [, seconds]) => sum + Number(seconds || 0), 0);
  return {
    now,
    trackingEnabled: settings.trackingEnabled,
    pausedReason: state.pausedReason,
    activity: state.activity,
    settings,
    categories: CATEGORY_DEFINITIONS,
    today: {
      totalActiveSeconds: Math.round(day.totalActiveSeconds || 0),
      driftSeconds: Math.round(driftSecondsToday),
      driftBudgetSeconds: settings.dailyDriftBudgetMinutes * 60,
      focusSeconds: Math.round(day.focusSeconds || 0),
      activeDomainSeconds: Math.round(activeDomainTodaySeconds),
      topDomains: topEntries(
        Object.fromEntries(Object.entries(day.domains || {}).map(([domain, data]) => [domain, data.activeSeconds])),
        6
      ),
      categories: topEntries(day.categories || {}, 10)
    },
    focus: state.focusSession ? {
      ...state.focusSession,
      remainingSeconds: Math.max(0, Math.ceil((state.focusSession.endsAt - now) / 1000))
    } : null,
    history: history ? {
      id: history.id,
      importedAt: history.importedAt,
      coverage: history.coverage,
      totals: history.totals,
      topSites: Object.entries(history.sites || {})
        .map(([name, site]) => ({
          name,
          category: site.category,
          seconds: site.estimatedActiveSeconds,
          visits: site.visits,
          averageSecondsPerVisit: site.averageSecondsPerVisit,
          maxSessionSeconds: site.maxSessionSeconds
        }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 8)
    } : null,
    currentBlock: block ? {
      id: block.id,
      start: block.start,
      activeSeconds: Math.round(block.activeSeconds),
      navigations: block.navigations,
      topDomains: topEntries(block.domainSeconds, 5),
      categories: topEntries(block.categorySeconds, 10),
      intentional: block.intentional,
      snoozeUntil: block.snoozeUntil,
      risk: scoring.risk,
      driftShare: scoring.driftShare,
      navigationRate: scoring.navigationRate
    } : null
  };
}

function summarizedBlock(block) {
  if (!block) {
    return null;
  }
  const { domainSequence, lastNavigationAt, lastNotifiedRisk, ...summary } = block;
  return summary;
}

function exportPayload(now = Date.now()) {
  return {
    schema: "drift-ledger-export-v1",
    version: 1,
    exportedAt: new Date(now).toISOString(),
    privacy: "Domain aggregates only. No page content, raw URLs, or search queries.",
    settings,
    daily: state.daily,
    currentBlock: summarizedBlock(state.currentBlock),
    archivedBlocks: state.archivedBlocks.map(summarizedBlock),
    focusSession: state.focusSession,
    focusHistory: state.focusHistory,
    historyBaseline: state.historyBaseline
  };
}

async function startFocus(minutes, label) {
  const now = Date.now();
  if (state.focusSession) {
    stopFocusSession(state, now);
  }
  const focus = startFocusSession(state, minutes || settings.focusDefaultMinutes, label, now);
  chrome.alarms.create(FOCUS_ALARM, { when: focus.endsAt });
  await evaluateAndNudge(now);
  await save();
  return focus;
}

async function stopFocus() {
  const session = stopFocusSession(state, Date.now());
  await callExtensionApi(chrome.alarms, "clear", FOCUS_ALARM);
  await evaluateAndNudge();
  await save();
  return session;
}

async function setSnooze(minutes) {
  if (!state.currentBlock) {
    return;
  }
  state.currentBlock.snoozeUntil = Date.now() + Math.max(1, Number(minutes || 15)) * 60 * 1000;
  state.currentBlock.lastNotifiedRisk = "low";
  await evaluateAndNudge();
  await save();
}

async function markIntentional() {
  if (!state.currentBlock) {
    return;
  }
  state.currentBlock.intentional = true;
  state.currentBlock.snoozeUntil = 0;
  await evaluateAndNudge();
  await save();
}

async function saveSettings(nextSettings) {
  settleCurrentActivity();
  const sanitized = sanitizeSettings({ ...settings, ...nextSettings });
  sanitized.highMinutes = Math.max(sanitized.highMinutes, sanitized.mediumMinutes + 5);
  settings = sanitized;
  await configureRuntime();
  if (!settings.trackingEnabled) {
    pauseActivity("tracking_off");
  }
  await evaluateAndNudge();
  await save();
  if (settings.trackingEnabled) {
    await syncActiveContext();
  }
}

async function handleMessage(message) {
  await load();
  switch (message?.type) {
    case "GET_SNAPSHOT":
      await syncActiveContext();
      return { ok: true, snapshot: snapshot() };
    case "SET_TRACKING":
      await saveSettings({ trackingEnabled: Boolean(message.enabled) });
      return { ok: true, snapshot: snapshot() };
    case "SAVE_SETTINGS":
      await saveSettings(message.settings || {});
      return { ok: true, snapshot: snapshot() };
    case "SNOOZE":
      await setSnooze(message.minutes || 15);
      return { ok: true, snapshot: snapshot() };
    case "MARK_INTENTIONAL":
      await markIntentional();
      return { ok: true, snapshot: snapshot() };
    case "START_FOCUS":
      await startFocus(message.minutes, message.label);
      return { ok: true, snapshot: snapshot() };
    case "STOP_FOCUS":
      await stopFocus();
      return { ok: true, snapshot: snapshot() };
    case "GET_DASHBOARD": {
      await syncActiveContext();
      const report = buildAnalyticsReport(state, settings, {
        days: message.days,
        now: Date.now()
      });
      return { ok: true, snapshot: snapshot(), report };
    }
    case "CLEAR_DATA":
      state = createEmptyState();
      await callExtensionApi(
        chrome.storage.local,
        "remove",
        [LEGACY_STORAGE_KEYS.settings, LEGACY_STORAGE_KEYS.state]
      );
      await updateBadge({ risk: "low", activeSeconds: 0 });
      await save();
      if (settings.trackingEnabled) {
        await syncActiveContext();
      }
      return { ok: true, snapshot: snapshot() };
    case "EXPORT_DATA":
      await syncActiveContext();
      return { ok: true, data: exportPayload() };
    case "IMPORT_HISTORY":
      state.historyBaseline = {
        ...sanitizeBraveHistoryImport(message.data),
        importedAt: new Date().toISOString()
      };
      await save();
      return { ok: true, snapshot: snapshot() };
    case "REMOVE_HISTORY":
      state.historyBaseline = null;
      await save();
      return { ok: true, snapshot: snapshot() };
    default:
      return { ok: false, error: "Unknown request" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  enqueue(() => handleMessage(message))
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.webNavigation.onCommitted.addListener((details) => {
  enqueue(() => handleNavigation(details));
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  enqueue(() => handleNavigation(details));
});

chrome.tabs.onActivated.addListener(() => {
  enqueue(syncActiveContext);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    await load();
    if (state.activity?.tabId === tabId) {
      await syncActiveContext();
    }
  });
});

chrome.windows.onFocusChanged.addListener(() => {
  enqueue(syncActiveContext);
});

chrome.idle.onStateChanged.addListener(() => {
  enqueue(syncActiveContext);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name === FOCUS_ALARM) {
    enqueue(syncActiveContext);
  }
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  enqueue(async () => {
    await load();
    if (!state.currentBlock || !notificationId.includes(state.currentBlock.id)) {
      return;
    }
    if (buttonIndex === 0) {
      await setSnooze(15);
    } else if (buttonIndex === 1) {
      await markIntentional();
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    await load();
    await configureRuntime();
    await syncActiveContext();
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    await load();
    await configureRuntime();
    await syncActiveContext();
  });
});

enqueue(async () => {
  await load();
  await configureRuntime();
  await syncActiveContext();
});
