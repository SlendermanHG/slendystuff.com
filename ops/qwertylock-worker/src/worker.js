const ALLOWED_ORIGINS = new Set([
  "https://slendystuff.com",
  "https://www.slendystuff.com",
  "http://localhost:4173",
  "http://localhost:9010"
]);

const MAX_BLOCK_CHARS = 8000;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const LEASE_SECONDS = 10 * 60;
const MAX_USE_LIMIT = 2;
const STATS_OBJECT_ID = "__qwertylock_private_stats__";
const STATS_BUCKET_MS = 60 * 60 * 1000;
const STATS_WINDOW_BUCKETS = 24;
const STATS_PAIRING_TTL_MS = 24 * 60 * 60 * 1000;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-QwertyLock-Stats-Token";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers.Vary = "Origin";
  }
  return headers;
}

function json(request, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request)
  });
}

function randomBase32(byteCount = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
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
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validateBlock(block) {
  const value = String(block || "").trim();
  if (value.length > MAX_BLOCK_CHARS) return "";
  const isQlr1 = /^QLR1\s+[a-z2-7]+\.[A-Z0-9_.,?\s]+$/i.test(value);
  const isQlr2 = /^QLR2\s+[a-z2-7]+\.[a-z2-7]+\.[a-z2-7\s]+$/i.test(value);
  if (!isQlr1 && !isQlr2) return "";
  return value;
}

function isForeverTtl(value) {
  return String(value || "").toLowerCase() === "forever";
}

function normalizeUseLimit(value) {
  const requested = Number(value || 1);
  return Math.max(1, Math.min(MAX_USE_LIMIT, Number.isFinite(requested) ? Math.floor(requested) : 1));
}

function durationLabel(ttlSeconds) {
  const seconds = Number(ttlSeconds || 0);
  if (seconds <= 0) return "forever";
  if (seconds === 10 * 60) return "10 minutes";
  if (seconds === 60 * 60) return "1 hour";
  if (seconds === 24 * 60 * 60) return "24 hours";
  return `${Math.round(seconds / 60)} minutes`;
}

function blockVersion(block) {
  return String(block || "").trim().slice(0, 4).toUpperCase() === "QLR1" ? "QLR1" : "QLR2";
}

async function readJson(request, maxChars = 20000) {
  const text = await request.text();
  if (text.length > maxChars) throw new Error("Request body is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch (_error) {
    return null;
  }
}

function toolUrl(env, id) {
  const base = String(env.PUBLIC_TOOL_URL || "https://slendystuff.com/r/").replace(/\/?$/, "/");
  return `${base}#m=${encodeURIComponent(id)}`;
}

async function messageStub(env, id) {
  const durableId = env.QLOCK_MESSAGE.idFromName(id);
  return env.QLOCK_MESSAGE.get(durableId);
}

async function statsStub(env) {
  const durableId = env.QLOCK_MESSAGE.idFromName(STATS_OBJECT_ID);
  return env.QLOCK_MESSAGE.get(durableId);
}

function statsToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (request.headers.get("X-QwertyLock-Stats-Token") || "").trim();
}

function isStatsAdmin(request, env) {
  const expected = String(env.STATS_ADMIN_TOKEN || "").trim();
  if (!expected) return false;
  return statsToken(request) === expected;
}

async function statsAccess(request, env) {
  if (isStatsAdmin(request, env)) return { ok: true, role: "admin" };
  const token = statsToken(request);
  if (!token) return { ok: false };
  try {
    const stats = await statsStub(env);
    const response = await stats.fetch("https://qwertylock-stats/stats/authorize", {
      method: "POST",
      body: JSON.stringify({ token })
    });
    const body = await response.json();
    return body.ok ? { ok: true, role: "device", device: body.device } : { ok: false };
  } catch (_error) {
    return { ok: false };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const createPath = "/api/qwertylock/messages";
    const statsPath = "/api/qwertylock/stats";
    const statsPairingStartPath = "/api/qwertylock/stats/pairing/start";
    const statsPairingClaimPath = "/api/qwertylock/stats/pairing/claim";
    const statsPairingClosePath = "/api/qwertylock/stats/pairing/close";
    const statsDeviceRegisterPath = "/api/qwertylock/stats/devices/register";
    const statsDevicesPath = "/api/qwertylock/stats/devices";
    const messageMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16})$/);
    const consumeMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16})\/consume$/);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json(request, 200, { ok: true });
    }

    if (url.pathname === statsPath && request.method === "GET") {
      if (!String(env.STATS_ADMIN_TOKEN || "").trim()) {
        return json(request, 503, { ok: false, error: "Stats are not configured." });
      }
      const access = await statsAccess(request, env);
      if (!access.ok) {
        return json(request, 403, { ok: false, error: "Stats access denied." });
      }
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/report");
      return json(request, response.status, await response.json());
    }

    if (url.pathname === statsDevicesPath && request.method === "GET") {
      const access = await statsAccess(request, env);
      if (!access.ok) return json(request, 403, { ok: false, error: "Stats access denied." });
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/devices");
      return json(request, response.status, await response.json());
    }

    if (url.pathname === statsDeviceRegisterPath && request.method === "POST") {
      if (!isStatsAdmin(request, env)) return json(request, 403, { ok: false, error: "Stats access denied." });
      const payload = await readJson(request, 4096);
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/devices/register", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
      return json(request, response.status, await response.json());
    }

    if (url.pathname === statsPairingStartPath && request.method === "POST") {
      if (!isStatsAdmin(request, env)) return json(request, 403, { ok: false, error: "Stats access denied." });
      const payload = await readJson(request, 4096);
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/pairing/start", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
      return json(request, response.status, await response.json());
    }

    if (url.pathname === statsPairingClaimPath && request.method === "POST") {
      const payload = await readJson(request, 4096);
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/pairing/claim", {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
      return json(request, response.status, await response.json());
    }

    if (url.pathname === statsPairingClosePath && request.method === "POST") {
      if (!isStatsAdmin(request, env)) return json(request, 403, { ok: false, error: "Stats access denied." });
      const stats = await statsStub(env);
      const response = await stats.fetch("https://qwertylock-stats/stats/pairing/close", { method: "POST" });
      return json(request, response.status, await response.json());
    }

    if (url.pathname === createPath && request.method === "POST") {
      const payload = await readJson(request);
      if (!payload) return json(request, 400, { ok: false, error: "Invalid JSON payload." });

      const block = validateBlock(payload.block);
      if (!block) return json(request, 400, { ok: false, error: "Invalid QLR block." });

      const ttlSeconds = isForeverTtl(payload.ttlMinutes)
        ? 0
        : Math.min(
          Math.max(Number(payload.ttlMinutes || 0) * 60 || DEFAULT_TTL_SECONDS, 5 * 60),
          MAX_TTL_SECONDS
        );
      const useLimit = normalizeUseLimit(payload.useLimit);

      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomBase32(10);
        const stub = await messageStub(env, id);
        const response = await stub.fetch("https://qwertylock-message/create", {
          method: "POST",
          body: JSON.stringify({ id, block, ttlSeconds, useLimit })
        });
        if (response.status === 201) {
          const created = await response.json();
          try {
            const stats = await statsStub(env);
            await stats.fetch("https://qwertylock-stats/stats/register", {
              method: "POST",
              body: JSON.stringify({
                id,
                createdAt: created.createdAt,
                expiresAt: created.expiresAt,
                ttlSeconds,
                useLimit,
                blockVersion: blockVersion(block)
              })
            });
          } catch (_error) {
            // Stats must never block private message creation.
          }
          return json(request, 201, {
            ok: true,
            id,
            url: toolUrl(env, id),
            expiresAt: created.expiresAt
          });
        }
      }

      return json(request, 503, { ok: false, error: "Could not allocate a private message ID." });
    }

    if (messageMatch && request.method === "GET") {
      const stub = await messageStub(env, messageMatch[1]);
      const opened = await stub.fetch("https://qwertylock-message/open");
      return json(request, opened.status, await opened.json());
    }

    if (consumeMatch && request.method === "POST") {
      const payload = await readJson(request, 2048);
      if (!payload) return json(request, 400, { ok: false, error: "Invalid JSON payload." });
      const stub = await messageStub(env, consumeMatch[1]);
      const consumed = await stub.fetch("https://qwertylock-message/consume", {
        method: "POST",
        body: JSON.stringify({ leaseToken: String(payload.leaseToken || "") })
      });
      const consumedBody = await consumed.json();
      if (consumed.status === 200 && consumedBody.ok) {
        try {
          const stats = await statsStub(env);
          await stats.fetch("https://qwertylock-stats/stats/consume", {
            method: "POST",
            body: JSON.stringify({
              id: consumeMatch[1],
              useLimit: consumedBody.useLimit,
              useCount: consumedBody.useCount,
              remainingUses: consumedBody.remainingUses
            })
          });
        } catch (_error) {
          // Usage counting must never block successful message consumption.
        }
      }
      return json(request, consumed.status, consumedBody);
    }

    return json(request, 404, { ok: false, error: "Not found." });
  }
};

export class QwertyLockMessage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "qwertylock-stats" || url.pathname.startsWith("/stats/")) {
      return this.handleStatsRequest(request, url);
    }

    if (url.pathname === "/create" && request.method === "POST") {
      const existing = await this.ctx.storage.get("message");
      if (existing) return Response.json({ ok: false, error: "Message ID already exists." }, { status: 409 });

      const payload = await request.json();
      const now = Date.now();
      const ttlSeconds = Number(payload.ttlSeconds || 0);
      const expiresAt = ttlSeconds > 0 ? now + ttlSeconds * 1000 : 0;
      await this.ctx.storage.put("message", {
        id: String(payload.id || ""),
        block: String(payload.block),
        createdAt: now,
        expiresAt,
        ttlSeconds,
        useLimit: normalizeUseLimit(payload.useLimit),
        useCount: 0,
        leaseToken: "",
        leaseUntil: 0
      });
      if (expiresAt) await this.ctx.storage.setAlarm(expiresAt);
      return Response.json({ ok: true, createdAt: now, expiresAt, ttlSeconds, useLimit: normalizeUseLimit(payload.useLimit) }, { status: 201 });
    }

    if (url.pathname === "/open" && request.method === "GET") {
      const message = await this.ctx.storage.get("message");
      if (!message) return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });

      const now = Date.now();
      if (Number(message.expiresAt || 0) > 0 && Number(message.expiresAt || 0) <= now) {
        await this.recordMessageRemoved(message, "expired");
        await this.ctx.storage.deleteAll();
        return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });
      }

      if (Number(message.useCount || 0) >= normalizeUseLimit(message.useLimit)) {
        await this.recordMessageRemoved(message, "limit_cleanup");
        await this.ctx.storage.deleteAll();
        return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });
      }

      if (message.leaseUntil && Number(message.leaseUntil) > now) {
        return Response.json({
          ok: false,
          error: "This private message is already open in another browser tab.",
          retryAfterSeconds: Math.ceil((Number(message.leaseUntil) - now) / 1000)
        }, { status: 409 });
      }

      message.leaseToken = randomToken();
      message.leaseUntil = now + LEASE_SECONDS * 1000;
      await this.ctx.storage.put("message", message);
      return Response.json({
        ok: true,
        block: message.block,
        leaseToken: message.leaseToken,
        leaseUntil: message.leaseUntil,
        expiresAt: message.expiresAt,
        useLimit: normalizeUseLimit(message.useLimit),
        useCount: Number(message.useCount || 0),
        remainingUses: normalizeUseLimit(message.useLimit) - Number(message.useCount || 0)
      });
    }

    if (url.pathname === "/consume" && request.method === "POST") {
      const payload = await request.json();
      const message = await this.ctx.storage.get("message");
      if (!message) return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });

      const now = Date.now();
      if (!payload.leaseToken || payload.leaseToken !== message.leaseToken || Number(message.leaseUntil || 0) <= now) {
        return Response.json({ ok: false, error: "This private message session expired. Reopen the link." }, { status: 409 });
      }

      const useLimit = normalizeUseLimit(message.useLimit);
      const useCount = Number(message.useCount || 0) + 1;
      const remainingUses = Math.max(0, useLimit - useCount);
      if (remainingUses <= 0) {
        await this.ctx.storage.deleteAll();
      } else {
        message.useLimit = useLimit;
        message.useCount = useCount;
        message.leaseToken = "";
        message.leaseUntil = 0;
        await this.ctx.storage.put("message", message);
      }
      return Response.json({ ok: true, remainingUses, useLimit, useCount });
    }

    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  async readStatsJson(request) {
    try {
      return await request.json();
    } catch (_error) {
      return {};
    }
  }

  bucketStart(time = Date.now()) {
    return Math.floor(Number(time || Date.now()) / STATS_BUCKET_MS) * STATS_BUCKET_MS;
  }

  async incrementCounter(key, amount = 1) {
    const current = Number(await this.ctx.storage.get(key) || 0);
    await this.ctx.storage.put(key, current + amount);
  }

  async incrementMap(key, field, amount = 1) {
    const map = await this.ctx.storage.get(key) || {};
    map[field] = Number(map[field] || 0) + amount;
    await this.ctx.storage.put(key, map);
  }

  async incrementBucket(kind, time = Date.now(), amount = 1) {
    const key = `bucket:${kind}:${this.bucketStart(time)}`;
    await this.incrementCounter(key, amount);
  }

  async hashToken(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token || "")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async deviceToken() {
    return randomToken(32);
  }

  cleanDeviceName(name) {
    return String(name || "Owner device").replace(/[^\w .:-]/g, "").trim().slice(0, 60) || "Owner device";
  }

  publicDevice(device) {
    return {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt || null,
      pairedVia: device.pairedVia || "manual"
    };
  }

  async devices() {
    const devices = await this.ctx.storage.get("devices") || {};
    return devices && typeof devices === "object" ? devices : {};
  }

  async saveDevices(devices) {
    await this.ctx.storage.put("devices", devices);
  }

  async createDevice(name, pairedVia = "manual") {
    const token = await this.deviceToken();
    const now = new Date().toISOString();
    const device = {
      id: randomBase32(8),
      name: this.cleanDeviceName(name),
      createdAt: now,
      lastSeenAt: null,
      pairedVia,
      tokenHash: await this.hashToken(token)
    };
    const devices = await this.devices();
    devices[device.id] = device;
    await this.saveDevices(devices);
    return { token, device: this.publicDevice(device) };
  }

  async authorizeDevice(token) {
    const tokenHash = await this.hashToken(token);
    const devices = await this.devices();
    for (const device of Object.values(devices)) {
      if (device.tokenHash === tokenHash) {
        device.lastSeenAt = new Date().toISOString();
        devices[device.id] = device;
        await this.saveDevices(devices);
        return this.publicDevice(device);
      }
    }
    return null;
  }

  async activeEntries() {
    const active = await this.ctx.storage.list({ prefix: "active:" });
    return [...active.entries()].map(([key, value]) => ({ key, value }));
  }

  async removeActiveMessage(id, reason) {
    if (!id) return;
    const key = `active:${id}`;
    const existing = await this.ctx.storage.get(key);
    if (!existing) return;
    await this.ctx.storage.delete(key);
    await this.incrementCounter(`total:${reason}`);
    await this.incrementBucket(reason, Date.now());
  }

  async pruneExpiredActive(now = Date.now()) {
    const entries = await this.activeEntries();
    for (const entry of entries) {
      const expiresAt = Number(entry.value.expiresAt || 0);
      if (expiresAt > 0 && expiresAt <= now) {
        await this.removeActiveMessage(entry.key.replace("active:", ""), "expired");
      }
    }
  }

  async handleStatsRequest(request, url) {
    if (url.pathname === "/stats/authorize" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const device = await this.authorizeDevice(payload.token);
      return Response.json(device ? { ok: true, device } : { ok: false }, { status: device ? 200 : 403 });
    }

    if (url.pathname === "/stats/devices" && request.method === "GET") {
      const devices = Object.values(await this.devices()).map((device) => this.publicDevice(device));
      devices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const pairing = await this.ctx.storage.get("pairing");
      return Response.json({
        ok: true,
        devices,
        pairing: pairing ? {
          createdAt: pairing.createdAt,
          expiresAt: pairing.expiresAt,
          pendingName: pairing.pendingName || "Owner phone"
        } : null
      });
    }

    if (url.pathname === "/stats/devices/register" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const created = await this.createDevice(payload.name || "Owner computer", "admin");
      return Response.json({ ok: true, ...created }, { status: 201 });
    }

    if (url.pathname === "/stats/pairing/start" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const code = randomToken(24);
      const now = Date.now();
      const expiresAt = now + STATS_PAIRING_TTL_MS;
      await this.ctx.storage.put("pairing", {
        codeHash: await this.hashToken(code),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        pendingName: this.cleanDeviceName(payload.deviceName || "Owner phone")
      });
      return Response.json({
        ok: true,
        code,
        pairUrl: `https://slendystuff.com/stats/?pair=${encodeURIComponent(code)}`,
        expiresAt: new Date(expiresAt).toISOString()
      }, { status: 201 });
    }

    if (url.pathname === "/stats/pairing/claim" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const pairing = await this.ctx.storage.get("pairing");
      if (!pairing) return Response.json({ ok: false, error: "No pairing session is open." }, { status: 410 });
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        await this.ctx.storage.delete("pairing");
        return Response.json({ ok: false, error: "Pairing session expired." }, { status: 410 });
      }
      if (await this.hashToken(payload.code) !== pairing.codeHash) {
        return Response.json({ ok: false, error: "Pairing code rejected." }, { status: 403 });
      }

      await this.ctx.storage.delete("pairing");
      const created = await this.createDevice(payload.deviceName || pairing.pendingName || "Owner phone", "pairing");
      return Response.json({ ok: true, ...created });
    }

    if (url.pathname === "/stats/pairing/close" && request.method === "POST") {
      await this.ctx.storage.delete("pairing");
      return Response.json({ ok: true });
    }

    if (url.pathname === "/stats/register" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const id = String(payload.id || "");
      if (!id) return Response.json({ ok: false, error: "Missing message id." }, { status: 400 });

      const createdAt = Number(payload.createdAt || Date.now());
      const ttlSeconds = Number(payload.ttlSeconds || 0);
      const useLimit = normalizeUseLimit(payload.useLimit);
      const record = {
        createdAt,
        expiresAt: Number(payload.expiresAt || 0),
        ttlSeconds,
        duration: durationLabel(ttlSeconds),
        useLimit,
        useCount: 0,
        remainingUses: useLimit,
        blockVersion: String(payload.blockVersion || "QLR2") === "QLR1" ? "QLR1" : "QLR2"
      };

      await this.ctx.storage.put(`active:${id}`, record);
      await this.incrementCounter("total:created");
      await this.incrementBucket("created", createdAt);
      await this.incrementMap("createdByDuration", record.duration);
      await this.incrementMap("createdByUseLimit", String(useLimit));
      await this.incrementMap("createdByVersion", record.blockVersion);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/stats/consume" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      const id = String(payload.id || "");
      const useLimit = normalizeUseLimit(payload.useLimit);
      const useCount = Number(payload.useCount || 0);
      const remainingUses = Math.max(0, Number(payload.remainingUses || 0));
      const activeKey = `active:${id}`;
      const active = await this.ctx.storage.get(activeKey);

      await this.incrementCounter("total:successfulUses");
      await this.incrementBucket("successfulUses", Date.now());
      await this.incrementMap("usesByUseLimit", String(useLimit));

      if (active) {
        active.useLimit = useLimit;
        active.useCount = useCount;
        active.remainingUses = remainingUses;
        if (remainingUses <= 0) {
          await this.ctx.storage.delete(activeKey);
          await this.incrementCounter("total:finalUseDeleted");
          await this.incrementBucket("finalUseDeleted", Date.now());
        } else {
          await this.ctx.storage.put(activeKey, active);
        }
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/stats/remove" && request.method === "POST") {
      const payload = await this.readStatsJson(request);
      await this.removeActiveMessage(String(payload.id || ""), String(payload.reason || "removed"));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/stats/report" && request.method === "GET") {
      const now = Date.now();
      await this.pruneExpiredActive(now);
      const active = (await this.activeEntries()).map((entry) => entry.value);

      const activeByDuration = {};
      const activeByUseLimit = {};
      const activeByVersion = {};
      for (const record of active) {
        activeByDuration[record.duration] = Number(activeByDuration[record.duration] || 0) + 1;
        activeByUseLimit[String(record.useLimit)] = Number(activeByUseLimit[String(record.useLimit)] || 0) + 1;
        activeByVersion[record.blockVersion] = Number(activeByVersion[record.blockVersion] || 0) + 1;
      }

      const hourly = {};
      for (const kind of ["created", "successfulUses", "expired", "finalUseDeleted"]) {
        hourly[kind] = [];
        const currentBucket = this.bucketStart(now);
        for (let offset = STATS_WINDOW_BUCKETS - 1; offset >= 0; offset--) {
          const bucket = currentBucket - offset * STATS_BUCKET_MS;
          hourly[kind].push({
            hourStart: new Date(bucket).toISOString(),
            count: Number(await this.ctx.storage.get(`bucket:${kind}:${bucket}`) || 0)
          });
        }
      }

      const sum = (rows) => rows.reduce((total, row) => total + Number(row.count || 0), 0);
      const activeBlocks = active
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .map((record, index) => ({
          record: index + 1,
          createdAt: new Date(Number(record.createdAt || 0)).toISOString(),
          ageMinutes: Math.max(0, Math.round((now - Number(record.createdAt || now)) / 60000)),
          duration: record.duration,
          ttlSeconds: Number(record.ttlSeconds || 0),
          expiresAt: Number(record.expiresAt || 0) ? new Date(Number(record.expiresAt)).toISOString() : null,
          useLimit: normalizeUseLimit(record.useLimit),
          useCount: Number(record.useCount || 0),
          remainingUses: Math.max(0, Number(record.remainingUses || 0)),
          blockVersion: record.blockVersion
        }));

      return Response.json({
        ok: true,
        generatedAt: new Date(now).toISOString(),
        privacy: {
          stored: "Only anonymous option metadata and active-message timing metadata.",
          notStored: ["message text", "passphrases", "encrypted block bodies in stats", "message ids in reports", "IP addresses", "user agents", "phone numbers"]
        },
        limitations: [
          "Active block inventory starts with messages created after this stats index was deployed.",
          "Older messages cannot be counted until they pass through updated create/open/consume/expiry code."
        ],
        last24h: {
          created: sum(hourly.created),
          successfulUses: sum(hourly.successfulUses),
          expired: sum(hourly.expired),
          finalUseDeleted: sum(hourly.finalUseDeleted),
          hourly
        },
        totals: {
          created: Number(await this.ctx.storage.get("total:created") || 0),
          successfulUses: Number(await this.ctx.storage.get("total:successfulUses") || 0),
          expired: Number(await this.ctx.storage.get("total:expired") || 0),
          finalUseDeleted: Number(await this.ctx.storage.get("total:finalUseDeleted") || 0),
          limitCleanup: Number(await this.ctx.storage.get("total:limit_cleanup") || 0)
        },
        options: {
          createdByDuration: await this.ctx.storage.get("createdByDuration") || {},
          createdByUseLimit: await this.ctx.storage.get("createdByUseLimit") || {},
          createdByVersion: await this.ctx.storage.get("createdByVersion") || {},
          usesByUseLimit: await this.ctx.storage.get("usesByUseLimit") || {},
          activeByDuration,
          activeByUseLimit,
          activeByVersion
        },
        active: {
          count: activeBlocks.length,
          blocks: activeBlocks
        }
      });
    }

    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  async recordMessageRemoved(message, reason) {
    const id = String(message?.id || "");
    if (!id) return;
    try {
      const stats = await statsStub(this.env);
      await stats.fetch("https://qwertylock-stats/stats/remove", {
        method: "POST",
        body: JSON.stringify({ id, reason })
      });
    } catch (_error) {
      // Message cleanup must not depend on analytics availability.
    }
  }

  async alarm() {
    const message = await this.ctx.storage.get("message");
    if (message) await this.recordMessageRemoved(message, "expired");
    await this.ctx.storage.deleteAll();
  }
}
