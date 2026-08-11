import { CATEGORY_DEFINITIONS, classifyDomain } from "./classifier.js";
import { DRIFT_CATEGORIES, scoreDrift } from "./driftScorer.js";
import { localDateKey } from "./sessionStore.js";

function sum(record = {}) {
  return Object.values(record).reduce((total, value) => total + Number(value || 0), 0);
}

function dateAtOffset(now, offsetDays) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return localDateKey(date.getTime());
}

function dateKeys(days, now) {
  return Array.from({ length: days }, (_, index) => dateAtOffset(now, index - days + 1));
}

function aggregateWindow(daily, keys) {
  return keys.reduce((result, key) => {
    const day = daily[key] || {};
    result.totalSeconds += Number(day.totalActiveSeconds || 0);
    result.visits += Object.values(day.domains || {})
      .reduce((total, site) => total + Number(site.visits || 0), 0);
    result.driftSeconds += Object.entries(day.categories || {})
      .filter(([category]) => DRIFT_CATEGORIES.has(category))
      .reduce((total, [, seconds]) => total + Number(seconds || 0), 0);
    return result;
  }, { totalSeconds: 0, driftSeconds: 0, visits: 0 });
}

function topName(items) {
  return items.length ? items[0].name : null;
}

function buildInsights(summary, sites, categories, settings) {
  const insights = [];
  const topSite = topName(sites);
  const topCategory = topName(categories);
  if (summary.daysOverDriftBudget >= 3) {
    insights.push(`Drift-heavy browsing crossed your daily budget on ${summary.daysOverDriftBudget} days.`);
  }
  if (summary.trendPercent !== null && summary.trendPercent >= 20) {
    insights.push(`Active browsing increased ${Math.round(summary.trendPercent)}% from the previous period.`);
  }
  if (summary.driftShare >= 0.6 && topSite) {
    insights.push(`${topSite} leads a period where most measured time was in drift categories.`);
  } else if (topCategory) {
    insights.push(`${CATEGORY_DEFINITIONS[topCategory]?.label || topCategory} was your largest measured category.`);
  }
  if (sites[0]?.averageSecondsPerVisit >= 10 * 60) {
    insights.push(`Visits to ${sites[0].name} averaged ${Math.round(sites[0].averageSecondsPerVisit / 60)} minutes.`);
  }
  if (!insights.length) {
    insights.push(`Measured browsing stayed within the ${settings.dailyDriftBudgetMinutes}-minute daily drift budget.`);
  }
  return insights.slice(0, 4);
}

export function buildAnalyticsReport(state, settings, options = {}) {
  const now = Number(options.now || Date.now());
  const days = Math.min(365, Math.max(1, Math.round(Number(options.days || 7))));
  const keys = dateKeys(days, now);
  const previousKeys = Array.from({ length: days }, (_, index) => dateAtOffset(now, index - (days * 2) + 1));
  const sitesByName = {};
  const categoryTotals = {};
  const hourlyTotals = Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, "0"), 0]));

  const dayRows = keys.map((date) => {
    const day = state.daily?.[date] || {};
    const driftSeconds = Object.entries(day.categories || {})
      .filter(([category]) => DRIFT_CATEGORIES.has(category))
      .reduce((total, [, seconds]) => total + Number(seconds || 0), 0);
    let visits = 0;
    for (const [domain, site] of Object.entries(day.domains || {})) {
      const aggregate = sitesByName[domain] ||= {
        name: domain,
        category: classifyDomain(domain, settings.domainOverrides),
        seconds: 0,
        visits: 0,
        sessions: 0,
        maxSessionSeconds: 0,
        activeDays: 0
      };
      aggregate.seconds += Number(site.activeSeconds || 0);
      aggregate.visits += Number(site.visits || 0);
      aggregate.sessions += Number(site.sessions || 0);
      aggregate.maxSessionSeconds = Math.max(aggregate.maxSessionSeconds, Number(site.maxSessionSeconds || 0));
      aggregate.activeDays += Number(site.activeSeconds || 0) > 0 ? 1 : 0;
      visits += Number(site.visits || 0);
    }
    for (const [category, seconds] of Object.entries(day.categories || {})) {
      categoryTotals[category] = (categoryTotals[category] || 0) + Number(seconds || 0);
    }
    for (const [hour, seconds] of Object.entries(day.hours || {})) {
      if (Object.prototype.hasOwnProperty.call(hourlyTotals, hour)) {
        hourlyTotals[hour] += Number(seconds || 0);
      }
    }
    return {
      date,
      totalSeconds: Math.round(Number(day.totalActiveSeconds || 0)),
      driftSeconds: Math.round(driftSeconds),
      focusSeconds: Math.round(Number(day.focusSeconds || 0)),
      focusSessions: Number(day.focusSessions || 0),
      visits
    };
  });

  const sites = Object.values(sitesByName)
    .map((site) => ({
      ...site,
      seconds: Math.round(site.seconds),
      averageSecondsPerVisit: site.visits ? site.seconds / site.visits : 0,
      averageSecondsPerSession: site.sessions ? site.seconds / site.sessions : 0
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const categories = Object.entries(categoryTotals)
    .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }))
    .sort((a, b) => b.seconds - a.seconds);
  const current = aggregateWindow(state.daily || {}, keys);
  const previous = aggregateWindow(state.daily || {}, previousKeys);
  const totalFocusSeconds = dayRows.reduce((total, day) => total + day.focusSeconds, 0);
  const activeDays = dayRows.filter((day) => day.totalSeconds > 0).length;
  const budgetSeconds = Number(settings.dailyDriftBudgetMinutes) * 60;
  const allBlocks = [...(state.archivedBlocks || []), ...(state.currentBlock ? [state.currentBlock] : [])]
    .filter((block) => localDateKey(Number(block.start || 0)) >= keys[0])
    .map((block) => {
      const scoring = scoreDrift(block, settings, now);
      return {
        id: block.id,
        start: block.start,
        end: block.end || block.lastActiveAt,
        activeSeconds: Math.round(Number(block.activeSeconds || 0)),
        navigations: Number(block.navigations || 0),
        risk: scoring.risk,
        driftShare: scoring.driftShare,
        intentional: Boolean(block.intentional),
        topDomains: Object.entries(block.domainSeconds || {})
          .map(([name, seconds]) => ({ name, seconds: Math.round(Number(seconds || 0)) }))
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 3)
      };
    })
    .sort((a, b) => b.start - a.start);
  const blocks = allBlocks.slice(0, 100);
  const summary = {
    totalSeconds: Math.round(current.totalSeconds),
    averageDailySeconds: Math.round(current.totalSeconds / days),
    activeDays,
    visits: current.visits,
    sessions: allBlocks.length,
    driftSeconds: Math.round(current.driftSeconds),
    driftShare: current.totalSeconds ? current.driftSeconds / current.totalSeconds : 0,
    focusSeconds: Math.round(totalFocusSeconds),
    focusSessions: dayRows.reduce((total, day) => total + day.focusSessions, 0),
    daysOverDriftBudget: dayRows.filter((day) => day.driftSeconds > budgetSeconds).length,
    longestDaySeconds: Math.max(0, ...dayRows.map((day) => day.totalSeconds)),
    longestBlockSeconds: Math.max(0, ...allBlocks.map((block) => block.activeSeconds)),
    trendPercent: previous.totalSeconds > 0
      ? ((current.totalSeconds - previous.totalSeconds) / previous.totalSeconds) * 100
      : null
  };

  return {
    generatedAt: new Date(now).toISOString(),
    range: { days, start: keys[0], end: keys.at(-1) },
    summary,
    days: dayRows,
    categories,
    sites,
    hourly: Object.entries(hourlyTotals).map(([hour, seconds]) => ({ hour, seconds: Math.round(seconds) })),
    blocks,
    insights: buildInsights(summary, sites, categories, settings),
    history: state.historyBaseline ? {
      coverage: state.historyBaseline.coverage,
      totals: state.historyBaseline.totals,
      topSites: Object.entries(state.historyBaseline.sites || {})
        .map(([name, site]) => ({ name, ...site }))
        .sort((a, b) => b.estimatedActiveSeconds - a.estimatedActiveSeconds)
        .slice(0, 50)
    } : null
  };
}
