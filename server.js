const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const IS_RENDER = String(process.env.RENDER || "").toLowerCase() === "true";
const PERSIST_ROOT = process.env.PERSIST_ROOT || (IS_RENDER ? "/var/data/websitemanbot" : ROOT_DIR);
const DATA_DIR = process.env.DATA_DIR || path.join(PERSIST_ROOT, "data");
const LOG_DIR_FALLBACK = process.env.LOG_DIR || path.join(PERSIST_ROOT, "logs");
const SETTINGS_PATH = process.env.SETTINGS_PATH || path.join(DATA_DIR, "settings.json");
const SECRETS_PATH = process.env.SECRETS_PATH || path.join(DATA_DIR, "secrets.json");
const SUPPORT_REQUESTS_PATH = process.env.SUPPORT_REQUESTS_PATH || path.join(DATA_DIR, "support-requests.json");

const SESSION_COOKIE = "slendy_admin_session";
const OWNER_BROWSER_COOKIE = "slendy_owner_browser";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OWNER_BROWSER_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const rateLimiterStore = new Map();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-admin-password";
const ADMIN_PASSWORD_MIN_LENGTH = Number(process.env.ADMIN_PASSWORD_MIN_LENGTH || 12);
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || (IS_PRODUCTION ? "true" : "false")).toLowerCase() === "true";
const ENFORCE_STRONG_ADMIN_PASSWORD =
  String(process.env.ENFORCE_STRONG_ADMIN_PASSWORD || (IS_PRODUCTION ? "true" : "false")).toLowerCase() === "true";
const CSRF_HEADER_NAME = "x-csrf-token";
const LOGIN_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
const SUPPORT_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 8 };
const TRACK_RATE_LIMIT = { windowMs: 60 * 1000, max: 120 };
const PORT = Number(process.env.PORT || 4173);

let settingsCache = null;
let secretsCache = null;
let supportRequestsCache = [];
let writeQueue = Promise.resolve();
let anydeskRefreshTimer = null;

const defaultSettings = {
  brand: {
    name: "Slendy Stuff",
    tagline: "Software help you can use right away",
    heroTitle: "Simple Tools, Smart Automation, and Real Support",
    heroSubtitle: "Pick what you need, get clear options, and get help quickly when you want it."
  },
  theme: {
    accentHex: "#ff2ea6"
  },
  stripeLinks: {
    starter: "https://buy.stripe.com/test_cNi7sNeB7fiW0Ni80g0gw05",
    pro: "https://buy.stripe.com/test_6oU14pfFbb2G0Ni0xO0gw06",
    reset: "https://buy.stripe.com/test_6oU8wRcsZc6K9jO3K00gw07"
  },
  support: {
    supportEmail: "admin@slendystuff.com",
    anydeskSourceUrl: "https://download.anydesk.com/AnyDesk.exe",
    anydeskDownloadUrl: "https://download.anydesk.com/AnyDesk.exe",
    anydeskLastCheckedAt: null,
    anydeskLastModified: null,
    anydeskContentLength: null,
    refreshIntervalHours: 12,
    intro: "Need help with cleanup, troubleshooting, or setup? Request support in a few quick steps."
  },
  analytics: {
    customTrackingEnabled: true
  },
  products: [
    {
      id: "pos-suite",
      title: "POS Suite",
      category: "Programs",
      summary: "Speed up checkout and daily operations with a cleaner point-of-sale experience.",
      priceLabel: "Custom Pricing",
      ctaLabel: "Request Details",
      ctaUrl: "mailto:admin@slendystuff.com?subject=POS%20Suite%20Inquiry",
      requires18Plus: false
    },
    {
      id: "system-optimizer",
      title: "System Optimizer",
      category: "Programs",
      summary: "Improve speed and stability on your Windows system with focused optimization tools.",
      priceLabel: "Custom Pricing",
      ctaLabel: "Request Details",
      ctaUrl: "mailto:admin@slendystuff.com?subject=System%20Optimizer%20Inquiry",
      requires18Plus: false
    },
    {
      id: "discord-bot-kit",
      title: "Discord Bot Kit",
      category: "Bots",
      summary: "Automate moderation, alerts, and routine tasks so your community runs smoothly.",
      priceLabel: "From $19.99",
      ctaLabel: "View Options",
      ctaUrl: "mailto:admin@slendystuff.com?subject=Discord%20Bot%20Inquiry",
      requires18Plus: false
    },
    {
      id: "remote-control-limited",
      title: "Remote Control Bot (Limited)",
      category: "Bots",
      summary: "Managed remote automation for approved use cases with defined safeguards.",
      priceLabel: "Custom Pricing",
      ctaLabel: "View Details",
      ctaUrl: "mailto:admin@slendystuff.com?subject=Remote%20Control%20Bot%20Inquiry",
      requires18Plus: true
    }
  ]
};

const defaultSecrets = {
  protonDriveLogPath: process.env.PROTON_LOG_DIR || LOG_DIR_FALLBACK,
  ownerBrowserToken: "",
  gaMeasurementId: "",
  metaPixelId: "",
  customWebhookUrl: "",
  apiKeys: {
    openai: "",
    discord: "",
    stripeSecret: ""
  }
};

const defaultSupportRequests = [];

function nowIso() {
  return new Date().toISOString();
}

function dayStamp() {
  return nowIso().slice(0, 10);
}

function dayStampOffset(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  const exists = await fileExists(filePath);
  if (!exists) {
    await fs.writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return structuredClone(fallback);
  }

  const raw = await fs.readFile(filePath, "utf8");
  return safeParseJson(raw, structuredClone(fallback));
}

function queueWrite(task) {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

async function saveJson(filePath, value) {
  await queueWrite(async () => {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  });
}

function normalizeSettings(payload) {
  const merged = {
    ...defaultSettings,
    ...payload,
    brand: { ...defaultSettings.brand, ...(payload.brand || {}) },
    theme: { ...defaultSettings.theme, ...(payload.theme || {}) },
    stripeLinks: { ...defaultSettings.stripeLinks, ...(payload.stripeLinks || {}) },
    support: { ...defaultSettings.support, ...(payload.support || {}) },
    analytics: { ...defaultSettings.analytics, ...(payload.analytics || {}) },
    products: Array.isArray(payload.products) ? payload.products : defaultSettings.products
  };

  merged.brand.name = truncate(merged.brand.name, 80);
  merged.brand.tagline = truncate(merged.brand.tagline, 160);
  merged.brand.heroTitle = truncate(merged.brand.heroTitle, 180);
  merged.brand.heroSubtitle = truncate(merged.brand.heroSubtitle, 400);
  merged.theme.accentHex = /^#[0-9a-fA-F]{6}$/.test(String(merged.theme.accentHex || ""))
    ? merged.theme.accentHex
    : defaultSettings.theme.accentHex;

  merged.stripeLinks.starter = normalizeCtaUrl(merged.stripeLinks.starter);
  merged.stripeLinks.pro = normalizeCtaUrl(merged.stripeLinks.pro);
  merged.stripeLinks.reset = normalizeCtaUrl(merged.stripeLinks.reset);

  merged.support.supportEmail = normalizeEmail(merged.support.supportEmail) || defaultSettings.support.supportEmail;
  merged.support.anydeskSourceUrl = normalizeHttpsUrl(merged.support.anydeskSourceUrl) || defaultSettings.support.anydeskSourceUrl;
  merged.support.refreshIntervalHours = Math.min(168, Math.max(1, Number(merged.support.refreshIntervalHours || 12)));
  merged.support.intro = truncate(merged.support.intro, 400);

  merged.products = merged.products
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: truncate(String(item.id || `item-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, "-"), 80),
      title: truncate(String(item.title || "Untitled").trim(), 120),
      category: truncate(String(item.category || "Programs").trim(), 80),
      summary: truncate(String(item.summary || "").trim(), 500),
      priceLabel: truncate(String(item.priceLabel || "").trim(), 60),
      ctaLabel: truncate(String(item.ctaLabel || "Learn More").trim(), 60),
      ctaUrl: normalizeCtaUrl(item.ctaUrl || "#"),
      requires18Plus: Boolean(item.requires18Plus)
    }));

  return merged;
}

function normalizeSecrets(payload) {
  const merged = {
    ...defaultSecrets,
    ...payload,
    apiKeys: {
      ...defaultSecrets.apiKeys,
      ...((payload && payload.apiKeys) || {})
    }
  };

  merged.protonDriveLogPath = String(merged.protonDriveLogPath || defaultSecrets.protonDriveLogPath).trim();
  merged.ownerBrowserToken = truncate(safeString(merged.ownerBrowserToken, "").trim(), 200);
  merged.gaMeasurementId = truncate(String(merged.gaMeasurementId || "").trim(), 64);
  merged.metaPixelId = truncate(String(merged.metaPixelId || "").trim(), 64);
  merged.customWebhookUrl = normalizeHttpsUrl(merged.customWebhookUrl);
  merged.apiKeys.openai = truncate(safeString(merged.apiKeys.openai, "").trim(), 300);
  merged.apiKeys.discord = truncate(safeString(merged.apiKeys.discord, "").trim(), 300);
  merged.apiKeys.stripeSecret = truncate(safeString(merged.apiKeys.stripeSecret, "").trim(), 300);

  return merged;
}

function normalizeSupportRequestStatus(value) {
  const normalized = safeString(value, "").toLowerCase();
  if (normalized === "in_progress") {
    return "in_progress";
  }
  if (normalized === "closed") {
    return "closed";
  }
  return "new";
}

function normalizeSupportRequest(item) {
  return {
    id: truncate(safeString(item.id, crypto.randomBytes(8).toString("hex")), 24),
    name: truncate(safeString(item.name, "Anonymous"), 120),
    email: normalizeEmail(item.email),
    issue: truncate(safeString(item.issue, ""), 2000),
    preferredTime: truncate(safeString(item.preferredTime, ""), 120),
    clientTimezone: truncate(safeString(item.clientTimezone, ""), 80),
    status: normalizeSupportRequestStatus(item.status),
    adminNotes: truncate(safeString(item.adminNotes, ""), 1200),
    createdAt: safeString(item.createdAt, nowIso()),
    updatedAt: safeString(item.updatedAt, safeString(item.createdAt, nowIso()))
  };
}

function normalizeSupportRequests(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((item) => item && typeof item === "object")
    .map((item) => normalizeSupportRequest(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function initData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR_FALLBACK, { recursive: true });

  settingsCache = normalizeSettings(await readJson(SETTINGS_PATH, defaultSettings));
  secretsCache = normalizeSecrets(await readJson(SECRETS_PATH, defaultSecrets));
  supportRequestsCache = normalizeSupportRequests(await readJson(SUPPORT_REQUESTS_PATH, defaultSupportRequests));
}

function resolveLogDir() {
  const configuredPath = String((secretsCache && secretsCache.protonDriveLogPath) || "").trim();
  if (!configuredPath) {
    return LOG_DIR_FALLBACK;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(ROOT_DIR, configuredPath);
}

function normalizeIpValue(value) {
  const raw = safeString(value, "").trim();
  if (!raw) {
    return "";
  }

  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function extractClientIps(req) {
  const ips = [];
  const add = (value) => {
    const normalized = normalizeIpValue(value);
    if (!normalized) {
      return;
    }
    if (!ips.includes(normalized)) {
      ips.push(normalized);
    }
  };

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    forwarded
      .split(",")
      .map((part) => part.trim())
      .forEach(add);
  }

  add(req.headers["x-real-ip"]);
  add(req.ip);
  add(req.socket && req.socket.remoteAddress);

  return ips.slice(0, 8);
}

function extractClientIp(req) {
  const ips = extractClientIps(req);
  return ips[0] || "unknown";
}

async function appendLog(logName, payload, req = null) {
  const logDir = resolveLogDir();
  const timestamp = nowIso();
  const filePath = path.join(logDir, `${logName}-${dayStamp()}.jsonl`);
  const entry = {
    timestamp,
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(req
      ? {
          ip: extractClientIp(req),
          ipChain: extractClientIps(req),
          userAgent: req.headers["user-agent"] || "unknown"
        }
      : {}),
    ...payload
  };

  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");

  if (secretsCache.customWebhookUrl) {
    fetch(secretsCache.customWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: logName, entry })
    }).catch(() => {
      // No-op: logging should not fail because webhook is unavailable.
    });
  }
}

async function readJsonLines(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => safeParseJson(line, null))
      .filter((item) => item && typeof item === "object");
  } catch {
    return [];
  }
}

async function readRecentLogEntries(logName, days = 7) {
  const logDir = resolveLogDir();
  const entries = [];
  for (let offset = 0; offset < days; offset += 1) {
    const stamp = dayStampOffset(offset);
    const filePath = path.join(logDir, `${logName}-${stamp}.jsonl`);
    const fileEntries = await readJsonLines(filePath);
    entries.push(...fileEntries);
  }

  return entries;
}

function entryTimestampMs(entry) {
  const parsed = Date.parse(safeString(entry.timestamp, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function countEntriesSince(entries, sinceMs) {
  return entries.reduce((count, entry) => (entryTimestampMs(entry) >= sinceMs ? count + 1 : count), 0);
}

function visitorKey(entry) {
  const visitorId = safeString(entry.visitorId, "").trim();
  if (visitorId) {
    return `vid:${visitorId}`;
  }
  const ip = safeString(entry.ip, "").trim();
  return ip ? `ip:${ip}` : "";
}

function uniqueVisitorsSince(entries, sinceMs) {
  const visitors = new Set();
  for (const entry of entries) {
    if (entryTimestampMs(entry) < sinceMs) {
      continue;
    }
    const key = visitorKey(entry);
    if (key) {
      visitors.add(key);
    }
  }
  return visitors.size;
}

function uniqueIpsSince(entries, sinceMs) {
  const ips = new Set();
  for (const entry of entries) {
    if (entryTimestampMs(entry) < sinceMs) {
      continue;
    }
    const ip = safeString(entry.ip, "").trim();
    if (ip) {
      ips.add(ip);
    }
  }
  return ips.size;
}

function sessionKey(entry) {
  const visitorId = safeString(entry.visitorId, "").trim() || safeString(entry.ip, "").trim() || "unknown";
  const sessionId = safeString(entry.sessionId, "").trim() || `legacy-${safeString(entry.ip, "unknown")}`;
  return `${visitorId}::${sessionId}`;
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildSessionSummaries(entries) {
  const sessionsByKey = new Map();

  for (const entry of entries) {
    const timestampMs = entryTimestampMs(entry);
    if (timestampMs <= 0) {
      continue;
    }

    const key = sessionKey(entry);
    const existing = sessionsByKey.get(key) || {
      key,
      visitorId: safeString(entry.visitorId, "").trim() || `ip:${safeString(entry.ip, "unknown")}`,
      sessionId: safeString(entry.sessionId, "").trim() || `legacy-${safeString(entry.ip, "unknown")}`,
      isOwner: false,
      firstSeenMs: timestampMs,
      lastSeenMs: timestampMs,
      eventCount: 0,
      sessionDurationMs: 0,
      latestPath: safeString(entry.path, ""),
      latestReferrer: safeString(entry.referrer, ""),
      ips: new Set(),
      userAgents: new Set()
    };

    existing.eventCount += 1;
    existing.firstSeenMs = Math.min(existing.firstSeenMs, timestampMs);
    existing.lastSeenMs = Math.max(existing.lastSeenMs, timestampMs);
    existing.isOwner = existing.isOwner || entry.owner === true;
    if (entry.path) existing.latestPath = safeString(entry.path, "");
    if (entry.referrer) existing.latestReferrer = safeString(entry.referrer, "");

    const ip = safeString(entry.ip, "").trim();
    if (ip) existing.ips.add(ip);

    const ua = truncate(safeString(entry.userAgent, "").trim(), 220);
    if (ua) existing.userAgents.add(ua);

    if (safeString(entry.eventName, "") === "session_end") {
      const explicitDuration = safeNumber(entry.sessionElapsedMs, 0);
      if (explicitDuration > 0) {
        existing.sessionDurationMs = Math.max(existing.sessionDurationMs, explicitDuration);
      }
    }

    sessionsByKey.set(key, existing);
  }

  return Array.from(sessionsByKey.values())
    .map((session) => {
      const fallbackDuration = Math.max(0, session.lastSeenMs - session.firstSeenMs);
      const durationMs = Math.max(session.sessionDurationMs, fallbackDuration);
      return {
        visitorId: session.visitorId,
        sessionId: session.sessionId,
        isOwner: session.isOwner,
        firstSeen: new Date(session.firstSeenMs).toISOString(),
        lastSeen: new Date(session.lastSeenMs).toISOString(),
        firstSeenMs: session.firstSeenMs,
        lastSeenMs: session.lastSeenMs,
        eventCount: session.eventCount,
        durationMs,
        latestPath: session.latestPath,
        latestReferrer: session.latestReferrer,
        ips: Array.from(session.ips),
        userAgents: Array.from(session.userAgents).slice(0, 3)
      };
    })
    .sort((left, right) => right.lastSeenMs - left.lastSeenMs);
}

function buildVisitorSummaries(sessionSummaries) {
  const visitors = new Map();

  for (const session of sessionSummaries) {
    const key = safeString(session.visitorId, "").trim() || "unknown";
    const existing = visitors.get(key) || {
      visitorId: key,
      isOwner: false,
      firstSeenMs: session.firstSeenMs,
      lastSeenMs: session.lastSeenMs,
      eventCount: 0,
      sessionCount: 0,
      totalConnectedMs: 0,
      latestPath: session.latestPath,
      latestReferrer: session.latestReferrer,
      ips: new Set(),
      userAgents: new Set()
    };

    existing.isOwner = existing.isOwner || session.isOwner;
    existing.firstSeenMs = Math.min(existing.firstSeenMs, session.firstSeenMs);
    existing.lastSeenMs = Math.max(existing.lastSeenMs, session.lastSeenMs);
    existing.eventCount += safeNumber(session.eventCount, 0);
    existing.sessionCount += 1;
    existing.totalConnectedMs += safeNumber(session.durationMs, 0);
    if (session.lastSeenMs >= existing.lastSeenMs) {
      existing.latestPath = safeString(session.latestPath, existing.latestPath);
      existing.latestReferrer = safeString(session.latestReferrer, existing.latestReferrer);
    }
    for (const ip of Array.isArray(session.ips) ? session.ips : []) {
      existing.ips.add(ip);
    }
    for (const ua of Array.isArray(session.userAgents) ? session.userAgents : []) {
      existing.userAgents.add(ua);
    }

    visitors.set(key, existing);
  }

  return Array.from(visitors.values())
    .map((visitor) => ({
      visitorId: visitor.visitorId,
      label: visitor.isOwner ? "Me" : "Visitor",
      isOwner: visitor.isOwner,
      firstSeen: new Date(visitor.firstSeenMs).toISOString(),
      lastSeen: new Date(visitor.lastSeenMs).toISOString(),
      firstSeenMs: visitor.firstSeenMs,
      lastSeenMs: visitor.lastSeenMs,
      eventCount: visitor.eventCount,
      sessionCount: visitor.sessionCount,
      totalConnectedMs: visitor.totalConnectedMs,
      latestPath: visitor.latestPath,
      latestReferrer: visitor.latestReferrer,
      ips: Array.from(visitor.ips),
      userAgents: Array.from(visitor.userAgents).slice(0, 3)
    }))
    .sort((left, right) => right.lastSeenMs - left.lastSeenMs);
}

function topCounts(values, topN = 5) {
  const counts = new Map();
  for (const value of values) {
    const key = truncate(String(value || "").trim(), 120);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, topN)
    .map(([label, count]) => ({ label, count }));
}

async function buildAdminStats() {
  const analyticsEntries = await readRecentLogEntries("analytics", 7);
  const supportLogEntries = await readRecentLogEntries("support-request", 7);
  const ageEntries = await readRecentLogEntries("age-verification", 7);
  const sessions = buildSessionSummaries(analyticsEntries);
  const visitors = buildVisitorSummaries(sessions);
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const since24h = now - oneDayMs;
  const since7d = now - oneDayMs * 7;
  const since15m = now - 15 * 60 * 1000;

  const topEvents = topCounts(analyticsEntries.map((entry) => entry.eventName), 6);
  const topProducts = topCounts(
    analyticsEntries
      .map((entry) => (entry.meta && typeof entry.meta === "object" ? entry.meta.productId : ""))
      .filter(Boolean),
    6
  );
  const topIps = topCounts(analyticsEntries.map((entry) => entry.ip), 10);

  const sessions24h = sessions.filter((item) => item.lastSeenMs >= since24h);
  const activeSessions15m = sessions.filter((item) => item.lastSeenMs >= since15m);
  const avgSessionMinutes24h =
    sessions24h.length > 0
      ? Number((sessions24h.reduce((sum, item) => sum + safeNumber(item.durationMs, 0), 0) / sessions24h.length / 60000).toFixed(1))
      : 0;
  const totalConnectedHours7d = Number(
    (sessions.reduce((sum, item) => sum + safeNumber(item.durationMs, 0), 0) / 3600000).toFixed(2)
  );

  return {
    generatedAt: nowIso(),
    traffic: {
      visitors24h: uniqueVisitorsSince(analyticsEntries, since24h),
      visitors7d: uniqueVisitorsSince(analyticsEntries, since7d),
      ips24h: uniqueIpsSince(analyticsEntries, since24h),
      ips7d: uniqueIpsSince(analyticsEntries, since7d),
      events24h: countEntriesSince(analyticsEntries, since24h),
      events7d: countEntriesSince(analyticsEntries, since7d),
      ownerEvents24h: analyticsEntries.filter((entry) => entry.owner === true && entryTimestampMs(entry) >= since24h).length
    },
    connections: {
      sessions24h: sessions24h.length,
      activeSessions15m: activeSessions15m.length,
      avgSessionMinutes24h,
      totalConnectedHours7d
    },
    support: {
      requests24h: countEntriesSince(supportLogEntries, since24h),
      requests7d: countEntriesSince(supportLogEntries, since7d),
      queueTotal: supportRequestsCache.length,
      queueNew: supportRequestsCache.filter((item) => item.status === "new").length,
      queueInProgress: supportRequestsCache.filter((item) => item.status === "in_progress").length,
      queueClosed: supportRequestsCache.filter((item) => item.status === "closed").length
    },
    ageGate: {
      approvals7d: ageEntries.filter((entry) => entry.allowed === true).length,
      denied7d: ageEntries.filter((entry) => entry.allowed === false).length
    },
    topEvents,
    topProducts,
    topIps,
    recentVisitors: visitors.slice(0, 120),
    recentSessions: sessions.slice(0, 180)
  };
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function truncate(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function normalizeUrl(value) {
  const raw = safeString(value, "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeHttpsUrl(value) {
  const parsed = normalizeUrl(value);
  return parsed.startsWith("https://") ? parsed : "";
}

function normalizeCtaUrl(value) {
  const raw = safeString(value, "").trim();
  if (!raw) {
    return "#";
  }

  if (raw.startsWith("#") || raw.startsWith("/")) {
    return raw;
  }

  if (raw.startsWith("mailto:") || raw.startsWith("tel:")) {
    return raw;
  }

  const parsed = normalizeUrl(raw);
  return parsed || "#";
}

function normalizeEmail(value) {
  const email = safeString(value, "").trim().toLowerCase();
  if (!email) {
    return "";
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function timingSafeEqualString(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function isStrongPassword(value) {
  const password = String(value || "");
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return false;
  }

  const rules = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
  return rules.every((rule) => rule.test(password));
}

function applySecurityHeaders(req, res, next) {
  const cspDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://stats.g.doubleclick.net"
  ];

  if (IS_PRODUCTION) {
    cspDirectives.push("upgrade-insecure-requests");
  }

  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  if (COOKIE_SECURE && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  next();
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const now = Date.now();

    if (rateLimiterStore.size > 5000) {
      for (const [entryKey, entryValue] of rateLimiterStore.entries()) {
        if (!entryValue || entryValue.resetAt <= now) {
          rateLimiterStore.delete(entryKey);
        }
      }
    }

    const key = `${keyPrefix}:${extractClientIp(req)}`;
    const bucket = rateLimiterStore.get(key);

    if (!bucket || bucket.resetAt <= now) {
      rateLimiterStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }

    bucket.count += 1;
    return next();
  };
}

function createAdminSession(req, res) {
  const token = crypto.randomBytes(24).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    expiresAt,
    csrfToken,
    createdAt: nowIso(),
    ip: extractClientIp(req)
  });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS
  });

  return { csrfToken };
}

function getAdminSessionFromRequest(req) {
  clearExpiredSessions();
  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  return sessions.get(token) || null;
}

function hasOwnerBrowser(req) {
  const cookieValue = safeString(req.cookies[OWNER_BROWSER_COOKIE], "").trim();
  const expected = safeString(secretsCache.ownerBrowserToken, "").trim();
  if (!cookieValue || !expected) {
    return false;
  }
  return timingSafeEqualString(cookieValue, expected);
}

function isOwnerRequest(req) {
  return Boolean(getAdminSessionFromRequest(req)) || hasOwnerBrowser(req);
}

function setOwnerBrowserCookie(res, token) {
  res.cookie(OWNER_BROWSER_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE,
    maxAge: OWNER_BROWSER_TTL_MS
  });
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, value] of sessions.entries()) {
    if (!value || value.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function requireAdmin(req, res, next) {
  const session = getAdminSessionFromRequest(req);

  if (!session) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  req.adminSession = session;
  next();
}

function isPasswordValid(inputPassword) {
  return timingSafeEqualString(inputPassword, ADMIN_PASSWORD);
}

function requireAdminCsrf(req, res, next) {
  const rawHeader = req.headers[CSRF_HEADER_NAME];
  const token = Array.isArray(rawHeader) ? safeString(rawHeader[0], "") : safeString(rawHeader, "");
  if (!token || !req.adminSession || !timingSafeEqualString(token, req.adminSession.csrfToken)) {
    return res.status(403).json({ ok: false, error: "CSRF token invalid or missing." });
  }

  return next();
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }

  const out = {};
  const keys = Object.keys(meta).slice(0, 20);
  for (const key of keys) {
    const safeKey = truncate(key, 80);
    const value = meta[key];
    if (typeof value === "string") {
      out[safeKey] = truncate(value, 500);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[safeKey] = value;
      continue;
    }
    out[safeKey] = truncate(JSON.stringify(value), 500);
  }

  return out;
}

function sanitizeClientContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    pageTitle: truncate(safeString(value.pageTitle, ""), 200),
    viewport: truncate(safeString(value.viewport, ""), 40),
    screen: truncate(safeString(value.screen, ""), 40),
    dpr: safeNumber(value.dpr, 0),
    colorDepth: safeNumber(value.colorDepth, 0),
    language: truncate(safeString(value.language, ""), 40),
    platform: truncate(safeString(value.platform, ""), 80),
    doNotTrack: truncate(safeString(value.doNotTrack, ""), 20),
    touchPoints: safeNumber(value.touchPoints, 0),
    cookiesEnabled: Boolean(value.cookiesEnabled)
  };
}

function getPublicConfig() {
  return {
    generatedAt: nowIso(),
    brand: settingsCache.brand,
    theme: settingsCache.theme,
    stripeLinks: settingsCache.stripeLinks,
    support: settingsCache.support,
    analytics: {
      customTrackingEnabled: settingsCache.analytics.customTrackingEnabled !== false,
      gaMeasurementId: secretsCache.gaMeasurementId,
      metaPixelId: secretsCache.metaPixelId
    },
    products: settingsCache.products
  };
}

async function saveSettingsAndSecrets({ settings, secrets }, actor = "admin") {
  settingsCache = normalizeSettings(settings || settingsCache);
  secretsCache = normalizeSecrets(secrets || secretsCache);

  await saveJson(SETTINGS_PATH, settingsCache);
  await saveJson(SECRETS_PATH, secretsCache);

  await appendLog("settings-change", {
    actor,
    changedAt: nowIso(),
    productCount: settingsCache.products.length,
    logPath: secretsCache.protonDriveLogPath
  });

  scheduleAnydeskRefresh();
}

async function refreshAnydeskLink(trigger = "scheduled") {
  const sourceUrl = safeString(settingsCache.support.anydeskSourceUrl, "https://download.anydesk.com/AnyDesk.exe") || "https://download.anydesk.com/AnyDesk.exe";

  try {
    const response = await fetch(sourceUrl, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    settingsCache.support.anydeskDownloadUrl = response.url || sourceUrl;
    settingsCache.support.anydeskLastCheckedAt = nowIso();
    settingsCache.support.anydeskLastModified = response.headers.get("last-modified");
    settingsCache.support.anydeskContentLength = response.headers.get("content-length");
    settingsCache.support.anydeskLastError = null;

    await saveJson(SETTINGS_PATH, settingsCache);

    await appendLog("anydesk-refresh", {
      trigger,
      sourceUrl,
      resolvedUrl: settingsCache.support.anydeskDownloadUrl,
      lastModified: settingsCache.support.anydeskLastModified,
      contentLength: settingsCache.support.anydeskContentLength
    });

    return { ok: true, sourceUrl, resolvedUrl: settingsCache.support.anydeskDownloadUrl };
  } catch (error) {
    settingsCache.support.anydeskLastCheckedAt = nowIso();
    settingsCache.support.anydeskLastError = safeString(error.message, "Unknown AnyDesk refresh error");
    await saveJson(SETTINGS_PATH, settingsCache);

    await appendLog("anydesk-refresh", {
      trigger,
      sourceUrl,
      error: settingsCache.support.anydeskLastError
    });

    return { ok: false, sourceUrl, error: settingsCache.support.anydeskLastError };
  }
}

function scheduleAnydeskRefresh() {
  if (anydeskRefreshTimer) {
    clearInterval(anydeskRefreshTimer);
  }

  const hours = Number(settingsCache.support.refreshIntervalHours || 12);
  const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;

  anydeskRefreshTimer = setInterval(() => {
    refreshAnydeskLink("scheduled").catch(() => {
      // No-op
    });
  }, intervalMs);
}

const loginRateLimiter = createRateLimiter({ ...LOGIN_RATE_LIMIT, keyPrefix: "admin-login" });
const supportRateLimiter = createRateLimiter({ ...SUPPORT_RATE_LIMIT, keyPrefix: "support-request" });
const trackRateLimiter = createRateLimiter({ ...TRACK_RATE_LIMIT, keyPrefix: "track" });

app.use(applySecurityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

app.use("/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/public-config", (_req, res) => {
  res.json({ ok: true, config: getPublicConfig() });
});

app.get("/api/support/anydesk", (_req, res) => {
  res.json({
    ok: true,
    anydesk: {
      downloadUrl: settingsCache.support.anydeskDownloadUrl,
      sourceUrl: settingsCache.support.anydeskSourceUrl,
      lastCheckedAt: settingsCache.support.anydeskLastCheckedAt,
      lastModified: settingsCache.support.anydeskLastModified,
      contentLength: settingsCache.support.anydeskContentLength,
      lastError: settingsCache.support.anydeskLastError || null
    }
  });
});

app.post("/api/track", trackRateLimiter, async (req, res) => {
  try {
    if (settingsCache.analytics.customTrackingEnabled === false) {
      return res.json({ ok: true, skipped: true });
    }

    const eventName = truncate(safeString(req.body.eventName, "event"), 80);
    const meta = sanitizeMeta(req.body.meta);
    const visitorId = truncate(safeString(req.body.visitorId, ""), 80);
    const sessionId = truncate(safeString(req.body.sessionId, ""), 80);
    const sessionStartedAt = truncate(safeString(req.body.sessionStartedAt, ""), 60);
    const sessionElapsedMs = Math.max(0, safeNumber(req.body.sessionElapsedMs, safeNumber(meta.durationMs, 0)));
    const owner = isOwnerRequest(req);

    await appendLog(
      "analytics",
      {
        eventName,
        owner,
        visitorId,
        sessionId,
        sessionStartedAt,
        sessionElapsedMs,
        path: truncate(safeString(req.body.path, ""), 200),
        referrer: truncate(safeString(req.body.referrer, ""), 200),
        clientTimezone: truncate(safeString(req.body.clientTimezone, ""), 80),
        clientContext: sanitizeClientContext(req.body.clientContext),
        meta
      },
      req
    );

    res.json({ ok: true, owner });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeString(error.message, "Tracking failure") });
  }
});

app.post("/api/age-verify", async (req, res) => {
  try {
    const answer = truncate(safeString(req.body.answer, "unknown").toLowerCase(), 10);
    const allowed = answer === "yes";

    await appendLog(
      "age-verification",
      {
        pageKey: truncate(safeString(req.body.pageKey, "unknown"), 120),
        answer,
        allowed,
        clientTimezone: truncate(safeString(req.body.clientTimezone, ""), 80),
        clientTime: truncate(safeString(req.body.clientTime, ""), 120)
      },
      req
    );

    res.json({ ok: true, allowed });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeString(error.message, "Age verification failure") });
  }
});

app.post("/api/support/request", supportRateLimiter, async (req, res) => {
  try {
    const requestDetails = normalizeSupportRequest({
      id: crypto.randomBytes(8).toString("hex"),
      name: truncate(safeString(req.body.name, "Anonymous"), 120),
      email: normalizeEmail(req.body.email),
      issue: truncate(safeString(req.body.issue, ""), 2000),
      preferredTime: truncate(safeString(req.body.preferredTime, ""), 120),
      clientTimezone: truncate(safeString(req.body.clientTimezone, ""), 80),
      status: "new",
      adminNotes: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    if (requestDetails.issue.length < 8) {
      return res.status(400).json({ ok: false, error: "Issue details are too short." });
    }

    supportRequestsCache = [requestDetails, ...supportRequestsCache].slice(0, 5000);
    await saveJson(SUPPORT_REQUESTS_PATH, supportRequestsCache);
    await appendLog("support-request", requestDetails, req);

    res.json({ ok: true, message: "Support request captured." });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeString(error.message, "Support request failure") });
  }
});

app.post("/api/admin/login", loginRateLimiter, async (req, res) => {
  try {
    if (!isPasswordValid(req.body.password)) {
      return res.status(401).json({ ok: false, error: "Invalid password" });
    }

    const session = createAdminSession(req, res);
    if (!safeString(secretsCache.ownerBrowserToken, "").trim()) {
      secretsCache.ownerBrowserToken = crypto.randomBytes(24).toString("hex");
      await saveJson(SECRETS_PATH, secretsCache);
    }
    setOwnerBrowserCookie(res, secretsCache.ownerBrowserToken);

    return res.json({ ok: true, csrfToken: session.csrfToken, ownerBrowserClaimed: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: safeString(error.message, "Login failed") });
  }
});

app.post("/api/admin/logout", requireAdmin, requireAdminCsrf, (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE
  });
  res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ ok: true, csrfToken: req.adminSession.csrfToken });
});

app.post("/api/admin/claim-owner-browser", requireAdmin, requireAdminCsrf, async (req, res) => {
  try {
    const token = crypto.randomBytes(24).toString("hex");
    secretsCache.ownerBrowserToken = token;
    await saveJson(SECRETS_PATH, secretsCache);
    setOwnerBrowserCookie(res, token);

    await appendLog(
      "owner-browser-claim",
      {
        claimedAt: nowIso(),
        actor: "admin"
      },
      req
    );

    return res.json({ ok: true, message: "This browser is now labeled as Me in site statistics." });
  } catch (error) {
    return res.status(500).json({ ok: false, error: safeString(error.message, "Failed to claim owner browser") });
  }
});

app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    settings: settingsCache,
    secrets: secretsCache
  });
});

app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  try {
    const stats = await buildAdminStats();
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeString(error.message, "Failed to load stats") });
  }
});

app.get("/api/admin/support-requests", requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    requests: supportRequestsCache
  });
});

app.patch("/api/admin/support-requests/:id", requireAdmin, requireAdminCsrf, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestId = truncate(safeString(req.params.id, ""), 24);
    const index = supportRequestsCache.findIndex((item) => item.id === requestId);
    if (index < 0) {
      return res.status(404).json({ ok: false, error: "Support request not found." });
    }

    const current = supportRequestsCache[index];
    const updated = normalizeSupportRequest({
      ...current,
      status: normalizeSupportRequestStatus(body.status || current.status),
      adminNotes: truncate(safeString(body.adminNotes, current.adminNotes), 1200),
      updatedAt: nowIso()
    });

    supportRequestsCache[index] = updated;
    await saveJson(SUPPORT_REQUESTS_PATH, supportRequestsCache);
    await appendLog(
      "support-request-admin-update",
      {
        requestId,
        status: updated.status,
        hasAdminNotes: Boolean(updated.adminNotes)
      },
      req
    );

    return res.json({ ok: true, request: updated });
  } catch (error) {
    return res.status(500).json({ ok: false, error: safeString(error.message, "Failed to update request") });
  }
});

app.put("/api/admin/settings", requireAdmin, requireAdminCsrf, async (req, res) => {
  try {
    const nextSettings = normalizeSettings(req.body.settings || settingsCache);
    const nextSecrets = normalizeSecrets(req.body.secrets || secretsCache);

    await saveSettingsAndSecrets({ settings: nextSettings, secrets: nextSecrets });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeString(error.message, "Failed to save settings") });
  }
});

app.post("/api/admin/refresh-anydesk", requireAdmin, requireAdminCsrf, async (_req, res) => {
  const result = await refreshAnydeskLink("manual");
  if (!result.ok) {
    return res.status(500).json(result);
  }

  return res.json(result);
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((err, _req, res, next) => {
  if (!err) {
    return next();
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "Request payload is too large." });
  }

  if (err instanceof SyntaxError && err.message.includes("JSON")) {
    return res.status(400).json({ ok: false, error: "Malformed JSON payload." });
  }

  return res.status(500).json({ ok: false, error: "Unexpected server error." });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}` });
});

async function start() {
  if (ENFORCE_STRONG_ADMIN_PASSWORD && !isStrongPassword(ADMIN_PASSWORD)) {
    throw new Error(
      `ADMIN_PASSWORD is too weak. Use at least ${ADMIN_PASSWORD_MIN_LENGTH} chars with upper/lower/digit/symbol.`
    );
  }

  await initData();
  scheduleAnydeskRefresh();
  await refreshAnydeskLink("startup");

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`Admin password source: ADMIN_PASSWORD env var.`);
    if (!ENFORCE_STRONG_ADMIN_PASSWORD) {
      console.warn("ENFORCE_STRONG_ADMIN_PASSWORD is disabled. Enable it for production hardening.");
    }
    console.log(`Logs currently target: ${resolveLogDir()}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
