const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "change-me-now");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "site-config.json");
const QWERTYLOCK_FILE = path.join(DATA_DIR, "qwertylock-messages.json");
const QWERTYLOCK_MAX_BLOCK = 8000;
const QWERTYLOCK_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const QWERTYLOCK_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const QWERTYLOCK_LEASE_MS = 10 * 60 * 1000;

const defaultConfig = {
  supportEmail: "support@slendystuff.com",
  discordUrl: "https://discord.gg/your-invite",
  twitchUrl: "https://twitch.tv/slendermanhg",
  youtubeUrl: "https://youtube.com/@slendermanhg",
  schedulerUrl: ""
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function ensureConfigFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(CONFIG_FILE);
  } catch (_error) {
    await saveConfig(defaultConfig);
  }
}

async function loadConfig() {
  await ensureConfigFile();
  const raw = await fsp.readFile(CONFIG_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { ...defaultConfig, ...parsed };
}

async function saveConfig(config) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = new Set([
    "https://slendystuff.com",
    "https://www.slendystuff.com",
    "http://localhost:4173",
    "http://localhost:9010"
  ]);
  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
}

function randomBase32(byteCount = 12) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let value = 0;
  let bits = 0;
  let out = "";
  for (const byte of crypto.randomBytes(byteCount)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function randomToken(byteCount = 24) {
  return crypto.randomBytes(byteCount).toString("base64url");
}

async function loadQwertylockMessages() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(QWERTYLOCK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveQwertylockMessages(messages) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(QWERTYLOCK_FILE, JSON.stringify(messages, null, 2), "utf8");
}

function cleanupQwertylockMessages(messages, now = Date.now()) {
  let changed = false;
  for (const [id, message] of Object.entries(messages)) {
    if (!message || Number(message.expiresAt || 0) <= now || message.consumedAt) {
      delete messages[id];
      changed = true;
      continue;
    }
    if (Number(message.leaseUntil || 0) <= now) {
      if (message.leaseToken || message.leaseUntil) {
        message.leaseToken = "";
        message.leaseUntil = 0;
        changed = true;
      }
    }
  }
  return changed;
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body || "{}");
  } catch (_error) {
    return null;
  }
}

function validateQwertylockBlock(block) {
  const value = String(block || "").trim();
  if (!value.startsWith("QLR1 ")) return "";
  if (value.length > QWERTYLOCK_MAX_BLOCK) return "";
  if (!/^QLR1\s+[a-z2-7]+\.[A-Z0-9_.,?\s]+$/i.test(value)) return "";
  return value;
}

function qwertylockMessageUrl(req, id) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "slendystuff.com";
  return `${proto}://${host}/r/#m=${encodeURIComponent(id)}`;
}

async function handleQwertylockApi(req, res, url) {
  const createPath = "/api/qwertylock/messages";
  const messageMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16,32})$/);
  const consumeMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16,32})\/consume$/);

  if (url.pathname === createPath && req.method === "POST") {
    const parsed = parseJsonBody(await readBody(req, 16 * 1024));
    if (!parsed) return sendJson(res, 400, { ok: false, error: "Invalid JSON payload." });

    const block = validateQwertylockBlock(parsed.block);
    if (!block) return sendJson(res, 400, { ok: false, error: "Invalid QLR1 block." });

    const ttlMs = Math.min(
      Math.max(Number(parsed.ttlMinutes || 0) * 60 * 1000 || QWERTYLOCK_DEFAULT_TTL_MS, 5 * 60 * 1000),
      QWERTYLOCK_MAX_TTL_MS
    );
    const now = Date.now();
    const messages = await loadQwertylockMessages();
    cleanupQwertylockMessages(messages, now);

    let id = randomBase32(10);
    while (messages[id]) id = randomBase32(10);

    messages[id] = {
      id,
      block,
      createdAt: now,
      expiresAt: now + ttlMs,
      leaseToken: "",
      leaseUntil: 0
    };
    await saveQwertylockMessages(messages);

    return sendJson(res, 201, {
      ok: true,
      id,
      url: qwertylockMessageUrl(req, id),
      expiresAt: messages[id].expiresAt
    });
  }

  if (messageMatch && req.method === "GET") {
    const id = messageMatch[1];
    const now = Date.now();
    const messages = await loadQwertylockMessages();
    const changed = cleanupQwertylockMessages(messages, now);
    const message = messages[id];
    if (!message) {
      if (changed) await saveQwertylockMessages(messages);
      return sendJson(res, 410, { ok: false, error: "This private message is gone." });
    }

    if (message.leaseUntil && message.leaseUntil > now) {
      if (changed) await saveQwertylockMessages(messages);
      return sendJson(res, 409, {
        ok: false,
        error: "This private message is already open in another browser tab.",
        retryAfterSeconds: Math.ceil((message.leaseUntil - now) / 1000)
      });
    }

    message.leaseToken = randomToken();
    message.leaseUntil = now + QWERTYLOCK_LEASE_MS;
    await saveQwertylockMessages(messages);

    return sendJson(res, 200, {
      ok: true,
      id,
      block: message.block,
      leaseToken: message.leaseToken,
      leaseUntil: message.leaseUntil,
      expiresAt: message.expiresAt
    });
  }

  if (consumeMatch && req.method === "POST") {
    const id = consumeMatch[1];
    const parsed = parseJsonBody(await readBody(req, 2048));
    if (!parsed) return sendJson(res, 400, { ok: false, error: "Invalid JSON payload." });

    const now = Date.now();
    const messages = await loadQwertylockMessages();
    cleanupQwertylockMessages(messages, now);
    const message = messages[id];
    if (!message) return sendJson(res, 410, { ok: false, error: "This private message is gone." });

    const supplied = String(parsed.leaseToken || "");
    if (!supplied || supplied !== message.leaseToken || Number(message.leaseUntil || 0) <= now) {
      await saveQwertylockMessages(messages);
      return sendJson(res, 409, { ok: false, error: "This private message session expired. Reopen the link." });
    }

    delete messages[id];
    await saveQwertylockMessages(messages);
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

function sanitizeConfig(payload) {
  return {
    supportEmail: String(payload.supportEmail || defaultConfig.supportEmail).trim(),
    discordUrl: String(payload.discordUrl || defaultConfig.discordUrl).trim(),
    twitchUrl: String(payload.twitchUrl || defaultConfig.twitchUrl).trim(),
    youtubeUrl: String(payload.youtubeUrl || defaultConfig.youtubeUrl).trim(),
    schedulerUrl: String(payload.schedulerUrl || "").trim()
  };
}

function isAuthorized(req) {
  const supplied = String(req.headers["x-admin-password"] || "");
  return supplied && supplied === ADMIN_PASSWORD;
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const qwertylockHandled = await handleQwertylockApi(req, res, url);
  if (qwertylockHandled !== false) return qwertylockHandled;

  if (req.url === "/api/site-config" && req.method === "GET") {
    const config = await loadConfig();
    return sendJson(res, 200, { ok: true, config });
  }

  if (req.url === "/api/admin/config" && req.method === "POST") {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: "Invalid admin password." });
    }
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch (_error) {
      return sendJson(res, 400, { ok: false, error: "Invalid JSON payload." });
    }
    const config = sanitizeConfig(parsed);
    await saveConfig(config);
    return sendJson(res, 200, { ok: true, config });
  }

  if (req.url === "/api/admin/config" && req.method === "GET") {
    if (!isAuthorized(req)) {
      return sendJson(res, 401, { ok: false, error: "Invalid admin password." });
    }
    const config = await loadConfig();
    return sendJson(res, 200, { ok: true, config });
  }

  if (req.url === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

async function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const body = await fsp.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
  });
  res.end(body);
}

function safePublicPath(urlPath) {
  const normalized = decodeURIComponent(urlPath.split("?")[0]);
  const requested = normalized === "/" ? "/index.html" : normalized;
  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

async function handleStatic(req, res) {
  const candidate = safePublicPath(req.url);
  if (!candidate) {
    return sendText(res, 400, "Bad request.");
  }

  try {
    const stat = await fsp.stat(candidate);
    if (stat.isFile()) {
      return await serveFile(candidate, res);
    }
    if (stat.isDirectory()) {
      const indexCandidate = path.join(candidate, "index.html");
      const indexStat = await fsp.stat(indexCandidate);
      if (indexStat.isFile()) {
        return await serveFile(indexCandidate, res);
      }
    }
  } catch (_error) {
    // Fall through to SPA-style page handling below.
  }

  const htmlCandidate = candidate.endsWith(".html") ? candidate : `${candidate}.html`;
  try {
    const stat = await fsp.stat(htmlCandidate);
    if (stat.isFile()) {
      return await serveFile(htmlCandidate, res);
    }
  } catch (_error) {
    // Continue.
  }

  const fallback = path.join(PUBLIC_DIR, "404.html");
  if (fs.existsSync(fallback)) {
    res.statusCode = 404;
    return serveFile(fallback, res);
  }
  return sendText(res, 404, "Not found.");
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendText(res, 400, "Bad request.");
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (handled !== false) return;
    }
    await handleStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : "Internal server error." });
  }
});

ensureConfigFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`SlendyStuff listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
