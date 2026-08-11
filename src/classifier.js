export const CATEGORY_DEFINITIONS = {
  social: { label: "Social / feed", color: "#e25f4b", role: "drift" },
  video: { label: "Video / streaming", color: "#247f83", role: "drift" },
  sports: { label: "Sports", color: "#d99a28", role: "drift" },
  game_stats: { label: "Game stats / esports", color: "#5576a8", role: "drift" },
  news: { label: "News", color: "#a6653f", role: "drift" },
  shopping: { label: "Shopping", color: "#b05c82", role: "drift" },
  communication: { label: "Communication", color: "#3f7c9b", role: "neutral" },
  learning: { label: "Learning", color: "#4e8b57", role: "supportive" },
  coding: { label: "Coding / practice", color: "#32705d", role: "supportive" },
  work: { label: "Work / admin", color: "#626f84", role: "supportive" },
  finance: { label: "Finance", color: "#997b28", role: "neutral" },
  search: { label: "Search / navigation", color: "#8a6f9f", role: "neutral" },
  other: { label: "Other", color: "#7b828a", role: "neutral" }
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
  news: [
    "bbc.com",
    "cnn.com",
    "reuters.com",
    "nytimes.com",
    "washingtonpost.com",
    "theguardian.com"
  ],
  shopping: [
    "amazon.com",
    "ebay.com",
    "etsy.com",
    "walmart.com"
  ],
  communication: [
    "discord.com",
    "gmail.com",
    "outlook.com",
    "slack.com",
    "zoom.us"
  ],
  learning: [
    "coursera.org",
    "edx.org",
    "khanacademy.org",
    "wikipedia.org"
  ],
  coding: [
    "neetcode.io",
    "leetcode.com",
    "github.com"
  ],
  work: [
    "asana.com",
    "atlassian.net",
    "linear.app",
    "notion.so",
    "office.com"
  ],
  finance: [
    "fidelity.com",
    "paypal.com",
    "schwab.com",
    "stripe.com"
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
