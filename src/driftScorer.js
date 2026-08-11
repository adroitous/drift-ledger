import { CATEGORY_DEFINITIONS } from "./classifier.js";

export const DRIFT_CATEGORIES = new Set(
  Object.entries(CATEGORY_DEFINITIONS)
    .filter(([, definition]) => definition.role === "drift")
    .map(([category]) => category)
);

function sumValues(record = {}) {
  return Object.values(record).reduce((sum, value) => sum + Number(value || 0), 0);
}

function recurringTopDomains(sequence = []) {
  if (sequence.length < 12) {
    return false;
  }

  const counts = sequence.reduce((accumulator, domain) => {
    accumulator[domain] = (accumulator[domain] || 0) + 1;
    return accumulator;
  }, {});
  const topThree = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const topShare = topThree.reduce((sum, [, count]) => sum + count, 0) / sequence.length;
  const switches = sequence.slice(1).filter((domain, index) => domain !== sequence[index]).length;
  return topThree.length >= 2 && topShare >= 0.8 && switches >= 6;
}

export function getDriftMetrics(block) {
  const activeSeconds = Number(block?.activeSeconds || 0);
  const driftSeconds = Object.entries(block?.categorySeconds || {})
    .filter(([category]) => DRIFT_CATEGORIES.has(category))
    .reduce((sum, [, seconds]) => sum + Number(seconds || 0), 0);
  const navigations = Number(block?.navigations || 0);

  return {
    activeSeconds,
    driftSeconds,
    driftShare: activeSeconds > 0 ? driftSeconds / activeSeconds : 0,
    navigations,
    navigationRate: activeSeconds > 0 ? navigations / (activeSeconds / 3600) : 0,
    recurringTopThree: recurringTopDomains(block?.domainSequence || []),
    categorizedSeconds: sumValues(block?.categorySeconds || {})
  };
}

export function scoreDrift(block, settings, now = Date.now()) {
  if (!block || block.intentional || Number(block.snoozeUntil || 0) > now) {
    return { risk: "low", reason: block?.intentional ? "intentional" : "below_threshold", ...getDriftMetrics(block) };
  }

  const metrics = getDriftMetrics(block);
  const highDuration = Number(settings.highMinutes) * 60;
  const mediumDuration = Number(settings.mediumMinutes) * 60;

  if (
    metrics.activeSeconds >= highDuration &&
    metrics.driftShare >= Number(settings.highDriftShare) &&
    (
      metrics.navigationRate >= Number(settings.highNavigationRate) ||
      metrics.recurringTopThree
    )
  ) {
    return { risk: "high", reason: "long_repetitive_block", ...metrics };
  }

  if (
    metrics.activeSeconds >= mediumDuration &&
    metrics.driftShare >= Number(settings.mediumDriftShare) &&
    metrics.navigations >= Number(settings.minimumNavigations)
  ) {
    return { risk: "medium", reason: "sustained_drift_mix", ...metrics };
  }

  return { risk: "low", reason: "below_threshold", ...metrics };
}
