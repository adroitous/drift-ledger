export const STORAGE_KEYS = {
  settings: "driftLedgerSettings",
  state: "driftLedgerState"
};

export const LEGACY_STORAGE_KEYS = {
  settings: "attentionSettings",
  state: "attentionState"
};

export const DEFAULT_SETTINGS = {
  trackingEnabled: true,
  mediumMinutes: 45,
  highMinutes: 90,
  mediumDriftShare: 0.6,
  highDriftShare: 0.75,
  minimumNavigations: 30,
  highNavigationRate: 40,
  idleDetectionSeconds: 60,
  sessionGapMinutes: 30,
  retentionDays: 30,
  domainOverrides: {}
};

function finiteNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function sanitizeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  return {
    trackingEnabled: Boolean(merged.trackingEnabled),
    mediumMinutes: finiteNumber(merged.mediumMinutes, 45, 5, 240),
    highMinutes: finiteNumber(merged.highMinutes, 90, 10, 480),
    mediumDriftShare: finiteNumber(merged.mediumDriftShare, 0.6, 0.1, 1),
    highDriftShare: finiteNumber(merged.highDriftShare, 0.75, 0.1, 1),
    minimumNavigations: Math.round(finiteNumber(merged.minimumNavigations, 30, 1, 500)),
    highNavigationRate: finiteNumber(merged.highNavigationRate, 40, 1, 500),
    idleDetectionSeconds: Math.round(finiteNumber(merged.idleDetectionSeconds, 60, 15, 900)),
    sessionGapMinutes: finiteNumber(merged.sessionGapMinutes, 30, 5, 240),
    retentionDays: Math.round(finiteNumber(merged.retentionDays, 30, 7, 365)),
    domainOverrides: typeof merged.domainOverrides === "object" && merged.domainOverrides
      ? merged.domainOverrides
      : {}
  };
}

export function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyActivity(now) {
  return {
    domain: null,
    category: null,
    tabId: null,
    windowId: null,
    counting: false,
    lastTickAt: now
  };
}

export function createEmptyState(now = Date.now()) {
  return {
    version: 1,
    daily: {},
    historyBaseline: null,
    currentBlock: null,
    archivedBlocks: [],
    activity: emptyActivity(now),
    pausedReason: "starting",
    lastSavedAt: now
  };
}

export function hydrateState(raw, now = Date.now()) {
  if (!raw || raw.version !== 1) {
    return createEmptyState(now);
  }

  const state = {
    ...createEmptyState(now),
    ...raw,
    daily: raw.daily || {},
    historyBaseline: raw.historyBaseline || null,
    archivedBlocks: Array.isArray(raw.archivedBlocks) ? raw.archivedBlocks : []
  };
  const activity = { ...emptyActivity(now), ...(raw.activity || {}) };
  if (now - Number(activity.lastTickAt || 0) > 5 * 60 * 1000) {
    activity.counting = false;
    activity.lastTickAt = now;
  }
  state.activity = activity;
  return state;
}

function newBlock(now) {
  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    start: now,
    lastActiveAt: now,
    activeSeconds: 0,
    navigations: 0,
    domainSeconds: {},
    categorySeconds: {},
    domainSequence: [],
    intentional: false,
    snoozeUntil: 0,
    lastNotifiedRisk: "low"
  };
}

export function ensureBlock(state, now, settings) {
  const gapMs = Number(settings.sessionGapMinutes) * 60 * 1000;
  if (state.currentBlock && now - Number(state.currentBlock.lastActiveAt || 0) > gapMs) {
    const completed = { ...state.currentBlock, end: state.currentBlock.lastActiveAt };
    if (completed.activeSeconds > 0 || completed.navigations > 0) {
      state.archivedBlocks.unshift(completed);
      state.archivedBlocks = state.archivedBlocks.slice(0, 100);
    }
    state.currentBlock = null;
  }

  if (!state.currentBlock) {
    state.currentBlock = newBlock(now);
  }
  return state.currentBlock;
}

function ensureDaily(state, now) {
  const key = localDateKey(now);
  if (!state.daily[key]) {
    state.daily[key] = { totalActiveSeconds: 0, domains: {}, categories: {} };
  }
  return state.daily[key];
}

function ensureDailyDomain(day, domain) {
  if (!day.domains[domain]) {
    day.domains[domain] = {
      activeSeconds: 0,
      visits: 0,
      sessions: 0,
      maxSessionSeconds: 0
    };
  }
  return day.domains[domain];
}

export function creditActivity(state, activity, seconds, now, settings) {
  if (!activity?.domain || !activity?.category || !Number.isFinite(seconds) || seconds <= 0) {
    return;
  }

  const block = ensureBlock(state, now, settings);
  const firstDomainCreditInBlock = !Object.prototype.hasOwnProperty.call(
    block.domainSeconds,
    activity.domain
  );
  block.activeSeconds += seconds;
  block.lastActiveAt = now;
  block.domainSeconds[activity.domain] = (block.domainSeconds[activity.domain] || 0) + seconds;
  block.categorySeconds[activity.category] = (block.categorySeconds[activity.category] || 0) + seconds;

  const day = ensureDaily(state, now);
  const domain = ensureDailyDomain(day, activity.domain);
  day.totalActiveSeconds += seconds;
  day.categories[activity.category] = (day.categories[activity.category] || 0) + seconds;
  domain.activeSeconds += seconds;
  domain.maxSessionSeconds = Math.max(domain.maxSessionSeconds, block.domainSeconds[activity.domain]);
  if (firstDomainCreditInBlock) {
    domain.sessions += 1;
  }
}

export function recordNavigation(state, domain, category, now, settings) {
  if (!domain) {
    return;
  }
  const block = ensureBlock(state, now, settings);
  if (now - Number(block.lastNavigationAt || 0) < 750) {
    block.lastActiveAt = now;
    return;
  }
  block.navigations += 1;
  block.lastNavigationAt = now;
  block.lastActiveAt = now;
  block.domainSequence.push(domain);
  block.domainSequence = block.domainSequence.slice(-200);

  const day = ensureDaily(state, now);
  ensureDailyDomain(day, domain).visits += 1;
  if (!day.categories[category]) {
    day.categories[category] = 0;
  }
}

export function pruneState(state, settings, now = Date.now()) {
  const cutoff = localDateKey(now - Number(settings.retentionDays) * 86400000);
  for (const key of Object.keys(state.daily)) {
    if (key < cutoff) {
      delete state.daily[key];
    }
  }
  const cutoffMs = now - Number(settings.retentionDays) * 86400000;
  state.archivedBlocks = state.archivedBlocks.filter((block) => Number(block.end || block.lastActiveAt) >= cutoffMs);
}

export function todaySummary(state, now = Date.now()) {
  return state.daily[localDateKey(now)] || { totalActiveSeconds: 0, domains: {}, categories: {} };
}
