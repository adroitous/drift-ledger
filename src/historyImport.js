import { CATEGORY_DEFINITIONS, classifyDomain, normalizeDomain } from "./classifier.js";

export const BRAVE_HISTORY_SCHEMA = "drift-ledger-brave-history-v1";
export const LEGACY_BRAVE_HISTORY_SCHEMA = "attention-monitor-brave-history-v1";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SECONDS = 10 * 365 * 24 * 60 * 60;

function finiteNumber(value, minimum = 0, maximum = MAX_SECONDS) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, number));
}

function finiteInteger(value, minimum = 0, maximum = 10_000_000) {
  return Math.round(finiteNumber(value, minimum, maximum));
}

function validDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function categoryName(value, domain) {
  return CATEGORY_DEFINITIONS[value] ? value : classifyDomain(domain);
}

function categorySeconds(source) {
  const result = {};
  for (const category of Object.keys(CATEGORY_DEFINITIONS)) {
    const seconds = finiteNumber(source?.[category]);
    if (seconds > 0) {
      result[category] = Math.round(seconds);
    }
  }
  return result;
}

function sanitizeDomainRecord(domain, record) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !record || typeof record !== "object") {
    return null;
  }
  return [normalized, {
    category: categoryName(record.category, normalized),
    estimatedActiveSeconds: finiteInteger(record.estimatedActiveSeconds),
    visits: finiteInteger(record.visits),
    sessions: finiteInteger(record.sessions),
    maxSessionSeconds: finiteInteger(record.maxSessionSeconds)
  }];
}

function sanitizeDaily(source) {
  const result = {};
  const entries = Object.entries(source || {}).slice(0, 3660);
  for (const [date, day] of entries) {
    if (!DATE_PATTERN.test(date) || !day || typeof day !== "object") {
      continue;
    }
    const domains = {};
    for (const [domain, record] of Object.entries(day.domains || {}).slice(0, 5000)) {
      const sanitized = sanitizeDomainRecord(domain, record);
      if (sanitized) {
        domains[sanitized[0]] = sanitized[1];
      }
    }
    result[date] = {
      estimatedActiveSeconds: finiteInteger(day.estimatedActiveSeconds),
      visits: finiteInteger(day.visits),
      domains,
      categories: categorySeconds(day.categories),
      drift: {
        estimatedSeconds: finiteInteger(day.drift?.estimatedSeconds),
        share: finiteNumber(day.drift?.share, 0, 1),
        mediumBlocks: finiteInteger(day.drift?.mediumBlocks, 0, 10000),
        highBlocks: finiteInteger(day.drift?.highBlocks, 0, 10000)
      }
    };
  }
  return result;
}

function sanitizeSites(source) {
  const result = {};
  for (const [domain, record] of Object.entries(source || {}).slice(0, 5000)) {
    const sanitized = sanitizeDomainRecord(domain, record);
    if (!sanitized) {
      continue;
    }
    result[sanitized[0]] = {
      ...sanitized[1],
      activeDays: finiteInteger(record.activeDays, 0, 3660),
      averageSecondsPerVisit: finiteNumber(record.averageSecondsPerVisit),
      averageSecondsPerSession: finiteNumber(record.averageSecondsPerSession)
    };
  }
  return result;
}

function sanitizeBlocks(source) {
  const result = [];
  for (const block of Array.isArray(source) ? source.slice(0, 1000) : []) {
    if (!validDateTime(block?.start) || !validDateTime(block?.end)) {
      continue;
    }
    const topDomains = [];
    for (const domain of Array.isArray(block.topDomains) ? block.topDomains.slice(0, 5) : []) {
      const normalized = normalizeDomain(domain);
      if (normalized && !topDomains.includes(normalized)) {
        topDomains.push(normalized);
      }
    }
    result.push({
      start: block.start,
      end: block.end,
      estimatedActiveSeconds: finiteInteger(block.estimatedActiveSeconds),
      visits: finiteInteger(block.visits),
      risk: block.risk === "high" ? "high" : "medium",
      driftSeconds: finiteInteger(block.driftSeconds),
      driftShare: finiteNumber(block.driftShare, 0, 1),
      navigationRate: finiteNumber(block.navigationRate, 0, 10000),
      topDomains,
      categories: categorySeconds(block.categories)
    });
  }
  return result;
}

export function sanitizeBraveHistoryImport(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("History import must be a JSON object.");
  }
  if (![BRAVE_HISTORY_SCHEMA, LEGACY_BRAVE_HISTORY_SCHEMA].includes(payload.schema)) {
    throw new Error("Unsupported Brave history import schema.");
  }
  if (payload.browser !== "Brave") {
    throw new Error("Only Brave history can be imported.");
  }
  if (!validDateTime(payload.coverage?.start) || !validDateTime(payload.coverage?.end)) {
    throw new Error("History coverage dates are invalid.");
  }
  if (Date.parse(payload.coverage.start) > Date.parse(payload.coverage.end)) {
    throw new Error("History coverage start must be before its end.");
  }
  if (
    payload.methodology?.fullUrlsStored !== false ||
    payload.methodology?.searchQueriesStored !== false ||
    payload.methodology?.pageContentStored !== false
  ) {
    throw new Error("History import must exclude URLs, queries, and page content.");
  }

  const daily = sanitizeDaily(payload.daily);
  const sites = sanitizeSites(payload.sites);
  const driftBlocks = sanitizeBlocks(payload.driftBlocks);
  const estimatedActiveSeconds = Object.values(daily)
    .reduce((sum, day) => sum + day.estimatedActiveSeconds, 0);
  const visits = Object.values(daily).reduce((sum, day) => sum + day.visits, 0);

  return {
    schema: BRAVE_HISTORY_SCHEMA,
    id: String(payload.id || "brave-history").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
    browser: "Brave",
    profile: String(payload.profile || "Default").slice(0, 80),
    generatedAt: validDateTime(payload.generatedAt)
      ? payload.generatedAt
      : new Date().toISOString(),
    coverage: {
      start: payload.coverage.start,
      end: payload.coverage.end
    },
    methodology: {
      measurement: "estimated",
      source: "Brave History database snapshot",
      inferenceCapSeconds: finiteInteger(payload.methodology.inferenceCapSeconds, 1, 3600),
      sessionGapSeconds: finiteInteger(payload.methodology.sessionGapSeconds, 60, 86400),
      recordedContributionSeconds: finiteInteger(payload.methodology.recordedContributionSeconds),
      inferredContributionSeconds: finiteInteger(payload.methodology.inferredContributionSeconds),
      fullUrlsStored: false,
      searchQueriesStored: false,
      pageContentStored: false
    },
    totals: {
      estimatedActiveSeconds,
      visits,
      activeDays: Object.values(daily).filter((day) => day.estimatedActiveSeconds > 0).length,
      sessions: finiteInteger(payload.totals?.sessions),
      mediumDriftBlocks: driftBlocks.filter((block) => block.risk === "medium").length,
      highDriftBlocks: driftBlocks.filter((block) => block.risk === "high").length
    },
    daily,
    sites,
    driftBlocks
  };
}
