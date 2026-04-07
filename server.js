const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "change-me-now");
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "site-config.json");

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
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
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (handled !== false) return;
    }
    await handleStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: "Internal server error." });
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
