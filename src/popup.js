import { sendRuntimeMessage } from "./chromeCompat.js";

const elements = {
  activityStatus: document.querySelector("#activityStatus"),
  trackingToggle: document.querySelector("#trackingToggle"),
  riskBadge: document.querySelector("#riskBadge"),
  blockDuration: document.querySelector("#blockDuration"),
  navigationCount: document.querySelector("#navigationCount"),
  driftShare: document.querySelector("#driftShare"),
  blockDomains: document.querySelector("#blockDomains"),
  blockState: document.querySelector("#blockState"),
  todayTotal: document.querySelector("#todayTotal"),
  categoryList: document.querySelector("#categoryList"),
  continueButton: document.querySelector("#continueButton"),
  snoozeButton: document.querySelector("#snoozeButton"),
  intentionalButton: document.querySelector("#intentionalButton"),
  optionsButton: document.querySelector("#optionsButton"),
  clearButton: document.querySelector("#clearButton")
};

function duration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds || 0)));
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function pausedLabel(reason) {
  const labels = {
    tracking_off: "Tracking off",
    idle: "Paused while idle",
    locked: "Paused while locked",
    browser_unfocused: "Paused outside Brave",
    incognito: "Incognito not tracked",
    unsupported_page: "Browser page not tracked",
    no_active_tab: "No active website",
    no_active_window: "No active browser window",
    starting: "Starting"
  };
  return labels[reason] || "Paused";
}

async function request(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Request failed");
  }
  return response;
}

function renderDomains(domains) {
  elements.blockDomains.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "No active website time yet";
    elements.blockDomains.append(empty);
    return;
  }
  for (const domain of domains.slice(0, 3)) {
    const item = document.createElement("span");
    item.className = "domain-item";
    const name = document.createElement("strong");
    name.textContent = domain.name;
    item.append(name, ` ${duration(domain.seconds)}`);
    elements.blockDomains.append(item);
  }
}

function renderCategories(snapshot) {
  const categories = snapshot.today.categories;
  const maximum = Math.max(1, ...categories.map((category) => category.seconds));
  elements.categoryList.replaceChildren();

  if (!categories.length || snapshot.today.totalActiveSeconds === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tracked time today";
    elements.categoryList.append(empty);
    return;
  }

  for (const category of categories.slice(0, 6)) {
    const definition = snapshot.categories[category.name] || snapshot.categories.other;
    const row = document.createElement("div");
    row.className = "category-row";

    const visual = document.createElement("div");
    const label = document.createElement("div");
    label.className = "category-label";
    label.textContent = definition.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(2, (category.seconds / maximum) * 100)}%`;
    fill.style.backgroundColor = definition.color;
    track.append(fill);
    visual.append(label, track);

    const time = document.createElement("span");
    time.className = "category-time";
    time.textContent = duration(category.seconds);
    row.append(visual, time);
    elements.categoryList.append(row);
  }
}

function render(snapshot) {
  const block = snapshot.currentBlock;
  elements.trackingToggle.checked = snapshot.trackingEnabled;
  elements.activityStatus.textContent = snapshot.activity?.counting
    ? `Active: ${snapshot.activity.domain}, ${duration(snapshot.today.activeDomainSeconds)} today`
    : pausedLabel(snapshot.pausedReason);

  const risk = block?.risk || "low";
  elements.riskBadge.className = `risk risk-${risk}`;
  elements.riskBadge.textContent = risk;
  elements.blockDuration.textContent = duration(block?.activeSeconds || 0);
  elements.navigationCount.textContent = String(block?.navigations || 0);
  elements.driftShare.textContent = `${Math.round((block?.driftShare || 0) * 100)}%`;
  renderDomains(block?.topDomains || []);
  elements.todayTotal.textContent = duration(snapshot.today.totalActiveSeconds);
  renderCategories(snapshot);

  const snoozed = Number(block?.snoozeUntil || 0) > snapshot.now;
  elements.blockState.hidden = !block?.intentional && !snoozed;
  elements.blockState.textContent = block?.intentional
    ? "This block is marked intentional."
    : snoozed
      ? `Reminder paused for ${duration((block.snoozeUntil - snapshot.now) / 1000)}.`
      : "";

  const hasBlock = Boolean(block);
  elements.snoozeButton.disabled = !hasBlock || block.intentional;
  elements.intentionalButton.disabled = !hasBlock || block.intentional;
}

async function refresh() {
  try {
    const response = await request({ type: "GET_SNAPSHOT" });
    render(response.snapshot);
  } catch (error) {
    elements.activityStatus.textContent = error.message;
  }
}

elements.trackingToggle.addEventListener("change", async () => {
  const response = await request({ type: "SET_TRACKING", enabled: elements.trackingToggle.checked });
  render(response.snapshot);
});

elements.continueButton.addEventListener("click", () => window.close());

elements.snoozeButton.addEventListener("click", async () => {
  const response = await request({ type: "SNOOZE", minutes: 15 });
  render(response.snapshot);
});

elements.intentionalButton.addEventListener("click", async () => {
  const response = await request({ type: "MARK_INTENTIONAL" });
  render(response.snapshot);
});

elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

elements.clearButton.addEventListener("click", async () => {
  if (!window.confirm("Clear all locally stored attention data?")) {
    return;
  }
  const response = await request({ type: "CLEAR_DATA" });
  render(response.snapshot);
});

refresh();
setInterval(refresh, 15000);
