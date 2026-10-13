// Only allowlisted aggregate dimensions are stored. Never log requests or bodies.
export const pages = new Set(['/', '/about.html', '/services.html', '/software.html', '/community.html', '/contact.html', '/slendystuffclicker/', '/slendystuffclicker/setup/', '/404.html']);
export const events = new Set(['page_view', 'download_click', 'setup_click', 'video_play', 'video_25', 'video_50', 'video_75', 'video_complete', 'feedback_accepted']);
const sources = new Set(['direct', 'site', 'search', 'social', 'other']);
const excludedCountries = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB']);
export const upsert = 'INSERT INTO daily_events (day,event,page,source,version,count) VALUES (?,?,?,?,?,1) ON CONFLICT(day,event,page,source,version) DO UPDATE SET count=count+1';
const redirects = new Map([
  ['/index.html', '/'], ['/support.html', '/contact.html'], ['/catalog.html', '/software.html'],
  ['/slendystuffclicker/index.html', '/slendystuffclicker/'], ['/slendystuffclicker/setup/index.html', '/slendystuffclicker/setup/']
]);
function response(status, body = null, headers = {}) {
  return new Response(body, {status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers}});
}
export function normalizeEvent(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !['event','page','source','version'].includes(key))) return null;
  if (!events.has(value.event) || !pages.has(value.page) || !sources.has(value.source)) return null;
  const product = value.page === '/slendystuffclicker/';
  const guide = value.page === '/slendystuffclicker/setup/';
  if (value.event !== 'page_view' && !(product || guide)) return null;
  if (['download_click','feedback_accepted'].includes(value.event) && !product) return null;
  if (value.version !== undefined && (value.event !== 'download_click' || typeof value.version !== 'string' || !/^\d{1,5}(\.\d{1,5}){3}$/.test(value.version))) return null;
  return {event:value.event, page:value.page, source:value.source, version:value.version || ''};
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== 'slendystuff.com') return response(404);
    if (redirects.has(url.pathname) && ['GET','HEAD'].includes(request.method)) {
      return response(308, null, {'Location':'https://slendystuff.com' + redirects.get(url.pathname)});
    }
    if (url.pathname === '/__analytics/health' && ['GET','HEAD'].includes(request.method)) {
      return response(200, request.method === 'HEAD' ? null : JSON.stringify({ready:!!env.DB && !!env.EVENT_LIMIT}), {'Content-Type':'application/json'});
    }
    if (url.pathname !== '/__analytics' || url.search) return response(404);
    if (request.method !== 'POST') return response(405, null, {'Allow':'POST'});
    const origin = request.headers.get('Origin');
    // A no-referrer policy can make same-origin POSTs serialize Origin as null.
    // Fetch Metadata is browser-controlled: never accept opaque cross-site requests.
    const privateSameOrigin = (origin === null || origin === 'null') && request.headers.get('Sec-Fetch-Site') === 'same-origin' && ['cors','same-origin'].includes(request.headers.get('Sec-Fetch-Mode'));
    if (origin !== 'https://slendystuff.com' && !privateSameOrigin) return response(403);
    if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1' || excludedCountries.has(request.cf?.country)) return response(204);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return response(415);
    if (!env.DB || !env.EVENT_LIMIT) return response(503);
    if (Number(request.headers.get('Content-Length')) > 1024) return response(413);
    // Transient rate-limit key only; never written to D1.
    try {
      const limit = await env.EVENT_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
      if (!limit.success) return response(429);
    } catch { return response(503); }
    const reader = request.body?.getReader();
    if (!reader) return response(400);
    const chunks = []; let length = 0, event;
    try {
      for (;;) {
        const {value,done} = await reader.read(); if(done) break;
        length += value.length;
        if(length > 1024) { await reader.cancel(); return response(413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for(const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
      event = normalizeEvent(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      if(!event) return response(400);
    } catch { return response(400); }
    try {
      await env.DB.prepare(upsert).bind(new Date().toISOString().slice(0,10),event.event,event.page,event.source,event.version).run();
      return response(204);
    } catch { return response(503); }
  },
  async scheduled(event, env) {
    // Bound retention of aggregate counters; no individual event history exists.
    await env.DB.prepare("DELETE FROM daily_events WHERE day < date('now','-90 days')").run();
  }
};
