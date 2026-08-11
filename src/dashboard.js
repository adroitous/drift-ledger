import { CATEGORY_DEFINITIONS } from "./classifier.js";
import { callExtensionApi, sendRuntimeMessage } from "./chromeCompat.js";

const elements = Object.fromEntries([
  "liveStatus", "focusSetup", "focusActive", "focusLabel", "startFocusButton", "stopFocusButton",
  "focusActiveLabel", "focusRemaining", "settingsButton", "totalActive", "dailyAverage", "driftMix",
  "totalVisits", "longestBlock", "focusTime", "rangeLabel", "dailyChart", "insightList", "activeDays",
  "daysOverBudget", "periodChange", "categoryBreakdown", "hourlyChart", "siteSearch", "siteRows",
  "siteEmpty", "blockRows", "blockCount", "historySection", "historyCoverage", "historyActive",
  "historyVisits", "historySessions", "historyDriftBlocks", "historySites", "exportCsvButton",
  "exportJsonButton", "dashboardStatus"
].map((id) => [id, document.querySelector(`#${id}`)]));

let selectedDays = 7;
let selectedFocusMinutes = 25;
let siteSort = "seconds";
let latestReport = null;
let latestSnapshot = null;

function duration(seconds, compact = false) {
  const rounded = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) {
    return compact ? `${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
  }
  if (rounded > 0 && rounded < 60) {
    return `${rounded}s`;
  }
  return `${minutes}m`;
}

function clock(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds || 0)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function dateLabel(value, options = {}) {
  return new Date(value).toLocaleDateString(undefined, options);
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

async function request(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Request failed");
  }
  return response;
}

function renderFocus(snapshot) {
  const focus = snapshot.focus;
  elements.focusSetup.hidden = Boolean(focus);
  elements.focusActive.hidden = !focus;
  if (focus) {
    elements.focusActiveLabel.textContent = focus.label;
    elements.focusRemaining.textContent = clock(focus.remainingSeconds);
  }
}

function renderSummary(report) {
  const summary = report.summary;
  elements.totalActive.textContent = duration(summary.totalSeconds);
  elements.dailyAverage.textContent = duration(summary.averageDailySeconds);
  elements.driftMix.textContent = percent(summary.driftShare);
  elements.totalVisits.textContent = summary.visits.toLocaleString();
  elements.longestBlock.textContent = duration(summary.longestBlockSeconds);
  elements.focusTime.textContent = duration(summary.focusSeconds);
  elements.activeDays.textContent = `${summary.activeDays} / ${report.range.days}`;
  elements.daysOverBudget.textContent = `${summary.daysOverDriftBudget} ${summary.daysOverDriftBudget === 1 ? "day" : "days"}`;
  elements.periodChange.textContent = summary.trendPercent === null
    ? "No comparison"
    : `${summary.trendPercent >= 0 ? "+" : ""}${Math.round(summary.trendPercent)}%`;
  elements.rangeLabel.textContent = `${report.range.start} to ${report.range.end}`;
}

function renderDaily(report) {
  const maximum = Math.max(1, ...report.days.map((day) => day.totalSeconds));
  const labelEvery = report.days.length <= 7 ? 1 : report.days.length <= 30 ? 5 : 15;
  elements.dailyChart.replaceChildren();
  report.days.forEach((day, index) => {
    const column = document.createElement("div");
    column.className = "day-column";
    column.title = `${day.date}: ${duration(day.totalSeconds)} active, ${duration(day.driftSeconds)} drift category`;
    const bars = document.createElement("div");
    bars.className = "day-bars";
    const active = document.createElement("div");
    active.className = "day-active";
    active.style.height = `${Math.max(day.totalSeconds ? 3 : 0, (day.totalSeconds / maximum) * 100)}%`;
    const drift = document.createElement("div");
    drift.className = "day-drift";
    drift.style.height = `${day.totalSeconds ? (day.driftSeconds / day.totalSeconds) * 100 : 0}%`;
    active.append(drift);
    bars.append(active);
    const label = document.createElement("span");
    label.className = "day-label";
    label.textContent = index % labelEvery === 0 || index === report.days.length - 1
      ? dateLabel(`${day.date}T12:00:00`, { month: "short", day: "numeric" })
      : "";
    column.append(bars, label);
    elements.dailyChart.append(column);
  });
}

function renderInsights(report) {
  elements.insightList.replaceChildren();
  for (const insight of report.insights) {
    const item = document.createElement("li");
    item.textContent = insight;
    elements.insightList.append(item);
  }
}

function renderCategories(report) {
  const maximum = Math.max(1, ...report.categories.map((category) => category.seconds));
  elements.categoryBreakdown.replaceChildren();
  if (!report.categories.length) {
    elements.categoryBreakdown.textContent = "No measured category time in this range.";
    elements.categoryBreakdown.className = "category-breakdown empty-state";
    return;
  }
  elements.categoryBreakdown.className = "category-breakdown";
  for (const category of report.categories) {
    const definition = CATEGORY_DEFINITIONS[category.name] || CATEGORY_DEFINITIONS.other;
    const row = document.createElement("div");
    row.className = "category-row";
    const name = document.createElement("strong");
    name.textContent = definition.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(2, (category.seconds / maximum) * 100)}%`;
    fill.style.backgroundColor = definition.color;
    track.append(fill);
    const time = document.createElement("span");
    time.textContent = duration(category.seconds);
    row.append(name, track, time);
    elements.categoryBreakdown.append(row);
  }
}

function renderHourly(report) {
  const maximum = Math.max(1, ...report.hourly.map((entry) => entry.seconds));
  elements.hourlyChart.replaceChildren();
  for (const entry of report.hourly) {
    const column = document.createElement("div");
    column.className = "hour-column";
    column.title = `${entry.hour}:00: ${duration(entry.seconds)}`;
    const bar = document.createElement("div");
    bar.className = "hour-bar";
    bar.style.height = `${Math.max(entry.seconds ? 3 : 0, (entry.seconds / maximum) * 100)}%`;
    const label = document.createElement("span");
    label.className = "hour-label";
    label.textContent = Number(entry.hour) % 3 === 0 ? String(Number(entry.hour)) : "";
    column.append(bar, label);
    elements.hourlyChart.append(column);
  }
}

function renderSites(report) {
  const query = elements.siteSearch.value.trim().toLowerCase();
  const sites = report.sites
    .filter((site) => site.name.includes(query))
    .sort((a, b) => Number(b[siteSort] || 0) - Number(a[siteSort] || 0));
  elements.siteRows.replaceChildren();
  elements.siteEmpty.hidden = sites.length > 0;
  for (const site of sites.slice(0, 100)) {
    const row = document.createElement("tr");
    const definition = CATEGORY_DEFINITIONS[site.category] || CATEGORY_DEFINITIONS.other;
    const cells = [
      site.name,
      definition.label,
      duration(site.seconds),
      site.visits.toLocaleString(),
      duration(site.averageSecondsPerVisit),
      duration(site.averageSecondsPerSession),
      duration(site.maxSessionSeconds)
    ];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) {
        const dot = document.createElement("i");
        dot.className = "category-dot";
        dot.style.backgroundColor = definition.color;
        cell.append(dot, value);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    elements.siteRows.append(row);
  }
}

function renderBlocks(report) {
  elements.blockRows.replaceChildren();
  elements.blockCount.textContent = `${report.blocks.length} ${report.blocks.length === 1 ? "block" : "blocks"}`;
  if (!report.blocks.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No measured browsing blocks in this range.";
    elements.blockRows.append(empty);
    return;
  }
  for (const block of report.blocks.slice(0, 30)) {
    const row = document.createElement("div");
    row.className = "block-row";
    const when = document.createElement("time");
    when.dateTime = new Date(block.start).toISOString();
    when.textContent = new Date(block.start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const active = document.createElement("strong");
    active.textContent = duration(block.activeSeconds);
    const nav = document.createElement("span");
    nav.textContent = `${block.navigations} nav`;
    const domains = document.createElement("span");
    domains.className = "block-domains";
    domains.textContent = block.topDomains.map((domain) => domain.name).join(", ") || "No domain time";
    const risk = document.createElement("span");
    risk.className = `risk risk-${block.risk}`;
    risk.textContent = block.intentional ? "intentional" : block.risk;
    row.append(when, active, nav, domains, risk);
    elements.blockRows.append(row);
  }
}

function renderHistory(history) {
  elements.historySection.hidden = !history;
  if (!history) return;
  const totals = history.totals;
  elements.historyCoverage.textContent = `${dateLabel(history.coverage.start)} to ${dateLabel(history.coverage.end)}`;
  elements.historyActive.textContent = duration(totals.estimatedActiveSeconds);
  elements.historyVisits.textContent = Number(totals.visits || 0).toLocaleString();
  elements.historySessions.textContent = Number(totals.sessions || 0).toLocaleString();
  elements.historyDriftBlocks.textContent = Number((totals.mediumDriftBlocks || 0) + (totals.highDriftBlocks || 0)).toLocaleString();
  elements.historySites.replaceChildren();
  for (const site of history.topSites.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "history-site";
    const name = document.createElement("strong");
    name.textContent = site.name;
    const total = document.createElement("span");
    total.textContent = duration(site.estimatedActiveSeconds);
    const average = document.createElement("span");
    average.textContent = `${duration(site.averageSecondsPerVisit)} / visit`;
    row.append(name, total, average);
    elements.historySites.append(row);
  }
}

function render(snapshot, report) {
  latestSnapshot = snapshot;
  latestReport = report;
  elements.liveStatus.textContent = snapshot.activity?.counting
    ? `Active on ${snapshot.activity.domain}`
    : snapshot.focus
      ? `Focus: ${snapshot.focus.label}`
      : "Tracking is ready";
  renderFocus(snapshot);
  renderSummary(report);
  renderDaily(report);
  renderInsights(report);
  renderCategories(report);
  renderHourly(report);
  renderSites(report);
  renderBlocks(report);
  renderHistory(report.history);
}

async function refresh() {
  try {
    const response = await request({ type: "GET_DASHBOARD", days: selectedDays });
    render(response.snapshot, response.report);
    elements.dashboardStatus.textContent = "";
  } catch (error) {
    elements.dashboardStatus.textContent = error.message;
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelectorAll(".range-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDays = Number(button.dataset.days);
    document.querySelectorAll(".range-button").forEach((item) => item.classList.toggle("is-selected", item === button));
    refresh();
  });
});

document.querySelectorAll(".duration-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFocusMinutes = Number(button.dataset.minutes);
    document.querySelectorAll(".duration-button").forEach((item) => item.classList.toggle("is-selected", item === button));
  });
});

elements.startFocusButton.addEventListener("click", async () => {
  const response = await request({
    type: "START_FOCUS",
    minutes: selectedFocusMinutes,
    label: elements.focusLabel.value
  });
  renderFocus(response.snapshot);
  refresh();
});

elements.stopFocusButton.addEventListener("click", async () => {
  const response = await request({ type: "STOP_FOCUS" });
  renderFocus(response.snapshot);
  refresh();
});

elements.settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.siteSearch.addEventListener("input", () => latestReport && renderSites(latestReport));
document.querySelectorAll("th button[data-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    siteSort = button.dataset.sort;
    if (latestReport) renderSites(latestReport);
  });
});

elements.exportCsvButton.addEventListener("click", () => {
  if (!latestReport) return;
  const rows = [["domain", "category", "active_seconds", "visits", "sessions", "average_seconds_per_visit", "average_seconds_per_session", "max_session_seconds"]];
  for (const site of latestReport.sites) {
    rows.push([site.name, site.category, site.seconds, site.visits, site.sessions, Math.round(site.averageSecondsPerVisit), Math.round(site.averageSecondsPerSession), site.maxSessionSeconds]);
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  download(`drift-ledger-sites-${latestReport.range.start}-to-${latestReport.range.end}.csv`, csv, "text/csv");
});

elements.exportJsonButton.addEventListener("click", async () => {
  const response = await request({ type: "EXPORT_DATA" });
  download(`drift-ledger-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(response.data, null, 2), "application/json");
});

setInterval(() => {
  if (!latestSnapshot?.focus) return;
  latestSnapshot.focus.remainingSeconds = Math.max(0, latestSnapshot.focus.remainingSeconds - 1);
  elements.focusRemaining.textContent = clock(latestSnapshot.focus.remainingSeconds);
  if (latestSnapshot.focus.remainingSeconds === 0) refresh();
}, 1000);
setInterval(refresh, 30000);
refresh();
