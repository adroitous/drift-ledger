import { CATEGORY_DEFINITIONS, normalizeDomain } from "./classifier.js";
import { sendRuntimeMessage } from "./chromeCompat.js";

const fields = {
  trackingEnabled: document.querySelector("#trackingEnabled"),
  mediumMinutes: document.querySelector("#mediumMinutes"),
  highMinutes: document.querySelector("#highMinutes"),
  mediumDriftShare: document.querySelector("#mediumDriftShare"),
  highDriftShare: document.querySelector("#highDriftShare"),
  minimumNavigations: document.querySelector("#minimumNavigations"),
  highNavigationRate: document.querySelector("#highNavigationRate"),
  idleDetectionSeconds: document.querySelector("#idleDetectionSeconds"),
  sessionGapMinutes: document.querySelector("#sessionGapMinutes"),
  overrideDomain: document.querySelector("#overrideDomain"),
  overrideCategory: document.querySelector("#overrideCategory"),
  overrideCount: document.querySelector("#overrideCount"),
  overrideList: document.querySelector("#overrideList"),
  saveStatus: document.querySelector("#saveStatus"),
  historySummary: document.querySelector("#historySummary"),
  historyCoverage: document.querySelector("#historyCoverage"),
  historyTime: document.querySelector("#historyTime"),
  historyVisits: document.querySelector("#historyVisits"),
  historyBlocks: document.querySelector("#historyBlocks"),
  historySites: document.querySelector("#historySites"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyFile: document.querySelector("#historyFile"),
  historyStatus: document.querySelector("#historyStatus"),
  removeHistoryButton: document.querySelector("#removeHistoryButton")
};

let domainOverrides = {};

async function request(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Request failed");
  }
  return response;
}

function populateCategorySelect() {
  fields.overrideCategory.replaceChildren();
  for (const [value, definition] of Object.entries(CATEGORY_DEFINITIONS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = definition.label;
    fields.overrideCategory.append(option);
  }
}

function renderOverrides() {
  fields.overrideList.replaceChildren();
  const entries = Object.entries(domainOverrides).sort((a, b) => a[0].localeCompare(b[0]));
  fields.overrideCount.textContent = `${entries.length} ${entries.length === 1 ? "override" : "overrides"}`;

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No custom domain categories";
    fields.overrideList.append(empty);
    return;
  }

  for (const [domain, category] of entries) {
    const row = document.createElement("div");
    row.className = "override-row";
    const domainName = document.createElement("span");
    domainName.textContent = domain;
    const categoryName = document.createElement("span");
    categoryName.className = "category-name";
    categoryName.textContent = CATEGORY_DEFINITIONS[category]?.label || category;
    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      delete domainOverrides[domain];
      renderOverrides();
    });
    row.append(domainName, categoryName, remove);
    fields.overrideList.append(row);
  }
}

function loadSettings(settings) {
  fields.trackingEnabled.checked = settings.trackingEnabled;
  fields.mediumMinutes.value = settings.mediumMinutes;
  fields.highMinutes.value = settings.highMinutes;
  fields.mediumDriftShare.value = Math.round(settings.mediumDriftShare * 100);
  fields.highDriftShare.value = Math.round(settings.highDriftShare * 100);
  fields.minimumNavigations.value = settings.minimumNavigations;
  fields.highNavigationRate.value = settings.highNavigationRate;
  fields.idleDetectionSeconds.value = settings.idleDetectionSeconds;
  fields.sessionGapMinutes.value = settings.sessionGapMinutes;
  domainOverrides = { ...settings.domainOverrides };
  renderOverrides();
}

function duration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderHistory(history) {
  const present = Boolean(history);
  fields.historySummary.hidden = !present;
  fields.historyEmpty.hidden = present;
  fields.removeHistoryButton.hidden = !present;
  fields.historySites.replaceChildren();
  if (!history) {
    return;
  }

  fields.historyCoverage.textContent = `${shortDate(history.coverage.start)} - ${shortDate(history.coverage.end)}`;
  fields.historyTime.textContent = duration(history.totals.estimatedActiveSeconds);
  fields.historyVisits.textContent = history.totals.visits.toLocaleString();
  fields.historyBlocks.textContent = String(
    history.totals.mediumDriftBlocks + history.totals.highDriftBlocks
  );

  for (const site of history.topSites.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "history-site-row";
    const domain = document.createElement("strong");
    domain.textContent = site.name;
    const total = document.createElement("span");
    total.textContent = duration(site.seconds);
    const average = document.createElement("span");
    average.textContent = `${Math.round(site.averageSecondsPerVisit)}s average / visit`;
    row.append(domain, total, average);
    fields.historySites.append(row);
  }
}

function formSettings() {
  return {
    trackingEnabled: fields.trackingEnabled.checked,
    mediumMinutes: Number(fields.mediumMinutes.value),
    highMinutes: Number(fields.highMinutes.value),
    mediumDriftShare: Number(fields.mediumDriftShare.value) / 100,
    highDriftShare: Number(fields.highDriftShare.value) / 100,
    minimumNavigations: Number(fields.minimumNavigations.value),
    highNavigationRate: Number(fields.highNavigationRate.value),
    idleDetectionSeconds: Number(fields.idleDetectionSeconds.value),
    sessionGapMinutes: Number(fields.sessionGapMinutes.value),
    domainOverrides
  };
}

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `drift-ledger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#addOverride").addEventListener("click", () => {
  const domain = normalizeDomain(fields.overrideDomain.value);
  if (!domain) {
    fields.overrideDomain.setCustomValidity("Enter a valid website domain");
    fields.overrideDomain.reportValidity();
    return;
  }
  fields.overrideDomain.setCustomValidity("");
  domainOverrides[domain] = fields.overrideCategory.value;
  fields.overrideDomain.value = "";
  renderOverrides();
});

fields.overrideDomain.addEventListener("input", () => fields.overrideDomain.setCustomValidity(""));

document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  fields.saveStatus.textContent = "Saving";
  try {
    const response = await request({ type: "SAVE_SETTINGS", settings: formSettings() });
    loadSettings(response.snapshot.settings);
    fields.saveStatus.textContent = "Saved";
  } catch (error) {
    fields.saveStatus.textContent = error.message;
  }
});

document.querySelector("#exportButton").addEventListener("click", async () => {
  const response = await request({ type: "EXPORT_DATA" });
  downloadJson(response.data);
});

document.querySelector("#importHistoryButton").addEventListener("click", async () => {
  const [file] = fields.historyFile.files;
  if (!file) {
    fields.historyStatus.textContent = "Select a Brave history JSON file.";
    return;
  }
  fields.historyStatus.textContent = "Importing";
  try {
    const data = JSON.parse(await file.text());
    const response = await request({ type: "IMPORT_HISTORY", data });
    renderHistory(response.snapshot.history);
    fields.historyStatus.textContent = "Historical baseline imported";
  } catch (error) {
    fields.historyStatus.textContent = error.message;
  }
});

fields.removeHistoryButton.addEventListener("click", async () => {
  if (!window.confirm("Remove the imported Brave history baseline?")) {
    return;
  }
  const response = await request({ type: "REMOVE_HISTORY" });
  renderHistory(response.snapshot.history);
  fields.historyStatus.textContent = "Historical baseline removed";
});

document.querySelector("#clearButton").addEventListener("click", async () => {
  if (!window.confirm("Clear all locally stored attention data? This cannot be undone.")) {
    return;
  }
  const response = await request({ type: "CLEAR_DATA" });
  renderHistory(response.snapshot.history);
  fields.saveStatus.textContent = "Data cleared";
});

async function initialize() {
  populateCategorySelect();
  const response = await request({ type: "GET_SNAPSHOT" });
  loadSettings(response.snapshot.settings);
  renderHistory(response.snapshot.history);
}

initialize().catch((error) => {
  fields.saveStatus.textContent = error.message;
});
