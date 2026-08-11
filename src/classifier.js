export const CATEGORY_DEFINITIONS = {
  social: { label: "Social / feed", color: "#e25f4b" },
  video: { label: "Video / streaming", color: "#247f83" },
  sports: { label: "Sports", color: "#d99a28" },
  game_stats: { label: "Game stats / esports", color: "#5576a8" },
  coding: { label: "Coding / practice", color: "#4e8b57" },
  search: { label: "Search / navigation", color: "#8a6f9f" },
  other: { label: "Other", color: "#7b828a" }
};

export const DEFAULT_DOMAIN_RULES = {
  social: [
    "reddit.com",
    "x.com",
    "twitter.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com"
  ],
  video: [
    "youtube.com",
    "twitch.tv",
    "bilibili.com",
    "netflix.com"
  ],
  sports: [
    "espn.com",
    "mlb.com"
  ],
  game_stats: [
    "op.gg",
    "u.gg",
    "metatft.com",
    "datatft.com",
    "tftacademy.com",
    "vlr.gg",
    "chess.com"
  ],
  coding: [
    "neetcode.io",
    "leetcode.com",
    "github.com"
  ],
  search: [
    "google.com",
    "bing.com",
    "duckduckgo.com"
  ]
};

const COMMON_TWO_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.jp",
  "co.nz",
  "com.br",
  "com.mx",
  "co.in"
]);

function isIpAddress(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function normalizeDomain(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  let hostname;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    hostname = value.toLowerCase().trim().replace(/^www\./, "").replace(/\.$/, "");
  }

  if (!hostname || hostname === "localhost" || isIpAddress(hostname)) {
    return hostname || null;
  }

  hostname = hostname.replace(/^(www|m)\./, "");
  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }

  const lastTwo = parts.slice(-2).join(".");
  if (COMMON_TWO_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

function matchingOverride(domain, overrides) {
  const entries = Object.entries(overrides || {}).sort((a, b) => b[0].length - a[0].length);
  return entries.find(([candidate]) => domain === candidate || domain.endsWith(`.${candidate}`));
}

export function classifyDomain(domain, overrides = {}) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return "other";
  }

  const override = matchingOverride(normalized, overrides);
  if (override && CATEGORY_DEFINITIONS[override[1]]) {
    return override[1];
  }

  for (const [category, domains] of Object.entries(DEFAULT_DOMAIN_RULES)) {
    if (domains.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`))) {
      return category;
    }
  }
  return "other";
}

export function categoryLabel(category) {
  return CATEGORY_DEFINITIONS[category]?.label || CATEGORY_DEFINITIONS.other.label;
}
