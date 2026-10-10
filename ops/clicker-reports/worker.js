const DESTINATION = "slender@slendystuff.com";
const SENDER = "diagnostics@slendystuff.com";
const MAX_BODY = 196608;
const origins = new Set(["https://slendystuff.com", "https://www.slendystuff.com"]);
const states = new Set(["ready", "starting", "clicking", "paused", "complete", "stopped", "disconnected", "error", "unknown"]);
const reasons = new Set(["none", "unspecified", "game_unavailable", "game_memory_limit", "game_memory_growth", "game_handles_limit", "system_commit_pressure", "available_memory_low", "app_resources_limit", "resource_check_unavailable", "resource_check_timeout", "resource_check_or_log_failed"]);
const version = value => typeof value === "string" && /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(value) && value.split(".").every(n => +n <= 65534);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value, max, integer = false) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max && (!integer || Number.isInteger(value));

export function sanitizeDiagnostics(input) {
  if (!object(input) || input.schema !== 1 || input.app !== "SlendyStuffClicker" || !version(input.appVersion) || input.controllerProtocol !== 5 || !states.has(input.state) || !reasons.has(input.currentSafetyCode) || typeof input.logReadIncomplete !== "boolean" || !number(input.clicksThisRun, 1e9, true) || !number(input.purchasesThisRun, 1e9, true) || !Array.isArray(input.events) || input.events.length > 200) throw new Error("Invalid report");
  const limits = { cps:9999, limit:1e9, clicks:1e9, purchases:1e9, gameHandles:1e7, gameProcesses:1024, controllerHandles:1e7 };
  const events = input.events.map(event => {
    if (!object(event) || !["start", "start_blocked", "safety_stop", "resource_sample"].includes(event.event)) throw new Error("Invalid event");
    const clean = { event: event.event };
    if (reasons.has(event.reason)) clean.reason = event.reason;
    for (const [key, max] of Object.entries(limits)) if (number(event[key], max, true)) clean[key] = event[key];
    for (const key of ["autoBuy", "reduceEffects", "overrideCooldown"]) if (typeof event[key] === "boolean") clean[key] = event[key];
    clean.recordedAppVersion = version(event.recordedAppVersion) ? event.recordedAppVersion : "not_recorded";
    for (const key of ["gameMiB", "controllerMiB"]) if (number(event[key], 1e9)) clean[key] = Math.round(event[key] * 10) / 10;
    if (number(event.systemCommitPercent, 100)) clean.systemCommitPercent = Math.round(event.systemCommitPercent * 10) / 10;
    if (number(event.availableMemoryMiBBucket, 1e9)) clean.availableMemoryMiBBucket = Math.floor(event.availableMemoryMiBBucket / 128) * 128;
    if (number(event.secondsBeforeLatest, 604800)) clean.secondsBeforeLatest = Math.round(event.secondsBeforeLatest * 10) / 10;
    return clean;
  });
  return { schema:1, app:"SlendyStuffClicker", appVersion:input.appVersion, controllerProtocol:5, logReadIncomplete:input.logReadIncomplete, state:input.state, currentSafetyCode:input.currentSafetyCode, clicksThisRun:input.clicksThisRun, purchasesThisRun:input.purchasesThisRun, events };
}
export function sanitizeFeedback(input) {
  if (!object(input) || !["bug", "suggestion", "other"].includes(input.category) || typeof input.message !== "string" || input.message.trim().length < 5 || input.message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.message)) throw new Error("Invalid feedback");
  return { category:input.category, message:input.message.trim() }; // Explicitly typed text; no cookies, device or account fields.
}
function reply(status, payload, origin) {
  const headers = { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer" };
  if (origins.has(origin)) { headers["Access-Control-Allow-Origin"] = origin; headers.Vary = "Origin"; }
  return new Response(JSON.stringify(payload), { status, headers });
}
async function readBounded(request) {
  if (+(request.headers.get("content-length") || 0) > MAX_BODY) throw new Error("Body limit");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder("utf-8", { fatal:true }); let body = "", bytes = 0, timeout;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Body deadline")), 5000); });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > MAX_BODY) throw new Error("Body limit");
      body += decoder.decode(part.value, { stream:true });
    }
    body += decoder.decode(); return JSON.parse(body);
  } finally { clearTimeout(timeout); await reader.cancel().catch(() => {}); }
}
export async function handle(request, env) {
  const url = new URL(request.url), origin = request.headers.get("origin") || "";
  if (url.hostname !== "reports.slendystuff.com" || url.protocol !== "https:" || url.search) return reply(404, { accepted:false }, origin);
  if (origin && !origins.has(origin)) return reply(403, { accepted:false }, origin);
  if (request.method === "OPTIONS" && origins.has(origin) && ["/api/diagnostics", "/api/feedback", "/api/health"].includes(url.pathname)) {
    const response = reply(200, {}, origin);
    response.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Diagnostic-Submission");
    response.headers.set("Access-Control-Max-Age", "600"); return response;
  }
  if (url.pathname === "/api/health" && request.method === "GET") return reply(env.EMAIL && env.BUDGET && env.BURST ? 200 : 503, { ready:!!(env.EMAIL && env.BUDGET && env.BURST) }, origin);
  const kind = url.pathname === "/api/diagnostics" ? "diagnostics" : url.pathname === "/api/feedback" ? "feedback" : null;
  if (!kind) return reply(404, { accepted:false }, origin);
  if (request.method !== "POST") return reply(405, { accepted:false }, origin);
  if (!env.EMAIL || !env.BUDGET || !env.BURST) return reply(503, { accepted:false }, origin);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") || "")) return reply(415, { accepted:false }, origin);
  const id = request.headers.get("X-Diagnostic-Submission") || "";
  if (!/^[a-f0-9]{32}$/.test(id)) return reply(400, { accepted:false }, origin);
  // This transient abuse-control key is never put in email, storage, reports or application logs.
  if (!(await env.BURST.limit({ key:request.headers.get("cf-connecting-ip") || "unknown" })).success) return reply(429, { accepted:false }, origin);
  let clean;
  try { const input = await readBounded(request); clean = kind === "diagnostics" ? sanitizeDiagnostics(input) : sanitizeFeedback(input); }
  catch { return reply(400, { accepted:false }, origin); }
  const instance = env.BUDGET.get(env.BUDGET.idFromName("slendystuffclicker-mail-budget"));
  const result = await instance.fetch(new Request("https://internal/submit", { method:"POST", headers:{ "Content-Type":"application/json", "X-Report-Kind":kind, "X-Diagnostic-Submission":id }, body:JSON.stringify(clean) }));
  return reply(result.status, await result.json(), origin);
}
export default { async fetch(request, env) { try { return await handle(request, env); } catch { return reply(503, { accepted:false }, request.headers.get("origin") || ""); } } };

export class ReportBudget {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now(), day = Math.floor(now / 86400000), minute = Math.floor(now / 60000);
      const kind = request.headers.get("X-Report-Kind"), id = request.headers.get("X-Diagnostic-Submission");
      if (!["diagnostics", "feedback"].includes(kind) || !/^[a-f0-9]{32}$/.test(id || "")) return reply(400, { accepted:false });
      const input = await request.json(); let clean;
      try { clean = kind === "diagnostics" ? sanitizeDiagnostics(input) : sanitizeFeedback(input); } catch { return reply(400, { accepted:false }); }
      let budget = await this.ctx.storage.get("budget");
      if (!budget || budget.day !== day) budget = { day, attempts:0, minute, minuteAttempts:0, submissions:{} };
      if (budget.minute !== minute) { budget.minute = minute; budget.minuteAttempts = 0; }
      const text = JSON.stringify(clean, null, 2);
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kind + text)))).map(n => n.toString(16).padStart(2, "0")).join("");
      if (budget.submissions[id]) {
        const previous = budget.submissions[id];
        if (previous.hash !== fingerprint) return reply(409, { accepted:false });
        return reply(previous.sent ? 200 : 409, { accepted:previous.sent });
      }
      // A single global durable counter bounds inbox abuse across all Cloudflare locations.
      if (budget.attempts >= 100 || budget.minuteAttempts >= 5) return reply(429, { accepted:false });
      budget.attempts++; budget.minuteAttempts++; budget.submissions[id] = { hash:fingerprint, sent:false };
      await this.ctx.storage.put("budget", budget);
      await this.ctx.storage.setAlarm((day + 1) * 86400000);
      let timeout;
      try {
        const message = kind === "diagnostics"
          ? { from:SENDER, to:DESTINATION, subject:"SlendyStuffClicker diagnostics v" + clean.appVersion, text:"A user voluntarily shared this filtered technical report. No reply address was collected.\n\n" + text, attachments:[{ content:btoa(text), filename:"SlendyStuffClicker-diagnostics.json", type:"application/json", disposition:"attachment" }] }
          : { from:SENDER, to:DESTINATION, subject:"SlendyStuffClicker feedback: " + clean.category, text:"A visitor voluntarily submitted this feedback. No reply address was collected.\n\n" + clean.message };
        await Promise.race([this.env.EMAIL.send(message), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Mail deadline")), 12000); })]);
        budget.submissions[id].sent = true; await this.ctx.storage.put("budget", budget);
        return reply(200, { accepted:true });
      } catch { return reply(503, { accepted:false }); } // Preserve the pending ID so ambiguous sends cannot silently duplicate.
      finally { clearTimeout(timeout); }
    });
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const day = Math.floor(Date.now() / 86400000), budget = await this.ctx.storage.get("budget");
      if (!budget || budget.day < day) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm((day + 1) * 86400000);
    });
  }
}
