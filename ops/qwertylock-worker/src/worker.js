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
    headers["Access-Control-Allow-Headers"] = "Content-Type";
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const createPath = "/api/qwertylock/messages";
    const messageMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16})$/);
    const consumeMatch = url.pathname.match(/^\/api\/qwertylock\/messages\/([a-z2-7]{16})\/consume$/);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json(request, 200, { ok: true });
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
          body: JSON.stringify({ block, ttlSeconds, useLimit })
        });
        if (response.status === 201) {
          return json(request, 201, {
            ok: true,
            id,
            url: toolUrl(env, id),
            expiresAt: (await response.json()).expiresAt
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
      return json(request, consumed.status, await consumed.json());
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
    if (url.pathname === "/create" && request.method === "POST") {
      const existing = await this.ctx.storage.get("message");
      if (existing) return Response.json({ ok: false, error: "Message ID already exists." }, { status: 409 });

      const payload = await request.json();
      const now = Date.now();
      const ttlSeconds = Number(payload.ttlSeconds || 0);
      const expiresAt = ttlSeconds > 0 ? now + ttlSeconds * 1000 : 0;
      await this.ctx.storage.put("message", {
        block: String(payload.block),
        createdAt: now,
        expiresAt,
        useLimit: normalizeUseLimit(payload.useLimit),
        useCount: 0,
        leaseToken: "",
        leaseUntil: 0
      });
      if (expiresAt) await this.ctx.storage.setAlarm(expiresAt);
      return Response.json({ ok: true, expiresAt }, { status: 201 });
    }

    if (url.pathname === "/open" && request.method === "GET") {
      const message = await this.ctx.storage.get("message");
      if (!message) return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });

      const now = Date.now();
      if (Number(message.expiresAt || 0) > 0 && Number(message.expiresAt || 0) <= now) {
        await this.ctx.storage.deleteAll();
        return Response.json({ ok: false, error: "This private message is gone." }, { status: 410 });
      }

      if (Number(message.useCount || 0) >= normalizeUseLimit(message.useLimit)) {
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

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
