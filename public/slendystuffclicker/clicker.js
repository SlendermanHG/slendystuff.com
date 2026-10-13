(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const endpoint = 'https://reports.slendystuff.com';
  const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){3}$/.test(value) && value.split('.').every(n => +n <= 65534);
  async function json(url, max = 196608, options = {}) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(url, {cache:'no-store',credentials:'omit',redirect:'error',...options,signal:abort.signal});
      const contentLength = response.headers.get('content-length');
      if (!response.ok || (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > max)) || !response.body) throw Error('Unavailable');
      const reader = response.body.getReader(); let length = 0, parts = [];
      try { for (;;) {const chunk = await reader.read(); if(chunk.done) break; length += chunk.value.length; if(length > max) throw Error('Limit');parts.push(chunk.value);} }
      finally {await reader.cancel().catch(() => {});}
      const data = new Uint8Array(length); let offset = 0; for(const part of parts){data.set(part,offset);offset += part.length;}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    } finally {clearTimeout(timer);}
  }
  const refreshInterval = 300000;
  const freshFor = 360000;
  let refreshInFlight = null, lastAttempt = 0, lastSuccessfulCheck = null, displayedStats = null, verifiedAt = null;
  function disableDownload(message = 'The verified public download is not available yet. Check the release notes for news.') {
    verifiedAt = null;
    const link = byId('download');
    link.removeAttribute('href'); link.setAttribute('aria-disabled','true'); link.setAttribute('tabindex','-1');
    byId('release-status').textContent = message;
  }
  function validateStats(stats) {
    if(!stats || stats.status !== 'ok' || (stats.source !== undefined && stats.source !== 'github') || !Number.isSafeInteger(stats.totalDownloads) || stats.totalDownloads < 0 || !Array.isArray(stats.versions) || stats.versions.length > 1000) throw Error('Invalid counts');
    const checked = Date.parse(stats.checkedAt);
    if(!Number.isFinite(checked) || checked > Date.now() + 60000) throw Error('Invalid check time');
    let total = 0; const versions = new Set();
    for(const item of stats.versions) {
      if(!item || !validVersion(item.version) || versions.has(item.version) || !Number.isSafeInteger(item.downloads) || item.downloads < 0) throw Error('Invalid count');
      versions.add(item.version); total += item.downloads;
      if(!Number.isSafeInteger(total)) throw Error('Invalid total');
    }
    if(total !== stats.totalDownloads) throw Error('Inconsistent total');
    return checked;
  }
  function renderStats(stats) {
    displayedStats = stats;
    byId('download-count').textContent = stats.totalDownloads.toLocaleString();
    const rows = stats.versions.map(item => {
      const li = document.createElement('li'), version = document.createElement('span'), count = document.createElement('span');
      version.textContent = 'v' + item.version; count.textContent = item.downloads.toLocaleString(); li.append(version,count); return li;
    });
    byId('version-counts').replaceChildren(...rows);
  }
  function enableDownload(stats, product, checked) {
    const current = stats.current;
    if(product?.releaseReady === true && validVersion(product.version) && /^[a-f0-9]{64}$/.test(product.sha256) &&
      Number.isSafeInteger(product.size) && product.size > 0 && current &&
      current.version === product.version && current.sha256 === product.sha256 && current.size === product.size &&
      validVersion(current.version) &&
      current.url === `https://github.com/SlendermanHG/slendystuff.com/releases/download/v${current.version}/SlendyStuffClicker.exe` &&
      checked <= Date.now() + 60000 && Date.now() - checked <= freshFor) {
      const link = byId('download'); link.href = current.url; link.removeAttribute('aria-disabled'); link.removeAttribute('tabindex');
      verifiedAt = checked;
      byId('download-version').textContent = 'v' + current.version;
      byId('release-status').textContent = `GitHub release · ${(current.size/1048576).toFixed(1)} MB · SHA-256: ${current.sha256}`;
      return true;
    }
    disableDownload();
    return false;
  }
  byId('download').addEventListener('click',event => {
    if(verifiedAt === null || Date.now() - verifiedAt > freshFor || refreshInFlight) {
      event.preventDefault();
      disableDownload('The download check is stale. Wait for a fresh public release check before downloading.');
    }
  });
  function checkLabel(checked) { return new Date(checked).toLocaleString(); }
  async function refreshDownloads() {
    if(refreshInFlight || document.hidden) return refreshInFlight;
    lastAttempt = Date.now();
    disableDownload('Checking the current public EXE and download details…');
    byId('stats-status').textContent = lastSuccessfulCheck === null ? 'Checking published download counts…' : `Refreshing. Last successful GitHub check: ${checkLabel(lastSuccessfulCheck)}.`;
    refreshInFlight = (async () => {
      try {
        const stats = await json('/stats/slendystuffclicker.json',65536);
        const checked = validateStats(stats);
        renderStats(stats);
        if(stats.source !== 'github') {
          byId('stats-status').textContent = `Static fallback only; this data is known stale and was not just checked. Last source check: ${checkLabel(checked)}.`;
          disableDownload('The available release counts are a static fallback. The download link stays disabled until a fresh check succeeds.');
          return;
        }
        lastSuccessfulCheck = checked;
        byId('stats-status').textContent = `Last successful GitHub check: ${checkLabel(checked)}.`;
        const product = await json('/slendystuffclicker/product.json',8192);
        enableDownload(stats, product, checked);
        if(Date.now() - checked > freshFor) byId('stats-status').textContent = `GitHub counts are stale. Last successful check: ${checkLabel(checked)}.`;
        return;
      } catch {
        if(displayedStats && displayedStats.source !== 'github') {
          byId('stats-status').textContent = `Static fallback remains visible and is known stale; it was not checked now. Last source check: ${checkLabel(Date.parse(displayedStats.checkedAt))}.`;
        } else if(displayedStats) {
          byId('stats-status').textContent = `Download verification could not be refreshed. Last successful GitHub check: ${lastSuccessfulCheck === null ? 'none' : checkLabel(lastSuccessfulCheck)}.`;
        } else {
          byId('download-count').textContent = '—'; byId('version-counts').replaceChildren();
          byId('stats-status').textContent = 'Download counts are temporarily unavailable.';
        }
        disableDownload('A fresh release check failed. The download link is disabled until verification succeeds.');
      }
    })();
    try {await refreshInFlight;} finally {refreshInFlight = null;}
  }
  refreshDownloads();
  const refreshDue = () => Date.now() - lastAttempt >= refreshInterval ||
    (lastSuccessfulCheck !== null && Date.now() - lastSuccessfulCheck >= refreshInterval && Date.now() - lastAttempt >= 60000);
  setInterval(() => {if(!document.hidden && refreshDue()) refreshDownloads();}, 60000);
  document.addEventListener('visibilitychange',() => {
    if(!document.hidden && refreshDue()) refreshDownloads();
  });
  json('/slendystuffclicker/news.json',8192).then(news => {
    if(typeof news.title !== 'string' || news.title.length > 120 || typeof news.message !== 'string' || news.message.length > 1200) return;
    byId('news-title').textContent = news.title; byId('news-message').textContent = news.message;
    if(/^\d{4}-\d{2}-\d{2}$/.test(news.date)) byId('news-date').textContent = 'Posted ' + news.date;
  }).catch(() => {});
  let available = false, submission = null, uncertain = false;
  json(endpoint + '/api/health',4096).then(result => {
    if(result.ready !== true) throw Error('Unavailable');available = true;byId('feedback-send').disabled = false;
    byId('feedback-status').textContent = 'Nothing is sent until you choose Send feedback.';
  }).catch(() => {byId('feedback-status').textContent = 'Feedback sending is not available yet. Please check back.';});
  byId('feedback-message').addEventListener('input',() => {byId('feedback-length').textContent = byId('feedback-message').value.length.toLocaleString() + ' / 2,000';});
  byId('feedback-form').addEventListener('submit',async event => {
    event.preventDefault(); if(!available || uncertain || !byId('feedback-form').reportValidity()) return;
    const button = byId('feedback-send'); button.disabled = true; byId('feedback-status').textContent = 'Sending your feedback…';
    submission ||= Array.from(crypto.getRandomValues(new Uint8Array(16))).map(n=>n.toString(16).padStart(2,'0')).join('');
    try {
      const result = await json(endpoint + '/api/feedback',4096,{method:'POST',headers:{'Content-Type':'application/json','X-Diagnostic-Submission':submission},body:JSON.stringify({category:byId('feedback-category').value,message:byId('feedback-message').value.trim()})});
      if(result.accepted !== true) throw Error('Not accepted');
      document.dispatchEvent(new Event('slendystuff:feedback-accepted'));
      byId('feedback-status').textContent = 'Thank you. Your feedback was accepted for delivery to Slender.';available = false;
    } catch {uncertain = true;byId('feedback-status').textContent = 'Delivery could not be confirmed. Please check with Slender before sending again.';}
  });
})();
