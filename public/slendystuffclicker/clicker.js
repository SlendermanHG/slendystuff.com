(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const endpoint = 'https://reports.slendystuff.com';
  const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){3}$/.test(value) && value.split('.').every(n => +n <= 65534);
  async function json(url, max = 196608, options = {}) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(url, {cache:'no-store',credentials:'omit',redirect:'error',...options,signal:abort.signal});
      if (!response.ok || +response.headers.get('content-length') > max) throw Error('Unavailable');
      const reader = response.body.getReader(); let length = 0, parts = [];
      try { for (;;) {const chunk = await reader.read(); if(chunk.done) break; length += chunk.value.length; if(length > max) throw Error('Limit');parts.push(chunk.value);} }
      finally {await reader.cancel().catch(() => {});}
      const data = new Uint8Array(length); let offset = 0; for(const part of parts){data.set(part,offset);offset += part.length;}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    } finally {clearTimeout(timer);}
  }
  Promise.all([json('/stats/slendystuffclicker.json'),json('/slendystuffclicker/product.json')]).then(([stats,product]) => {
    if(stats.status !== 'ok' || !Number.isSafeInteger(stats.totalDownloads) || stats.totalDownloads < 0 || !Array.isArray(stats.versions) || stats.versions.length > 1000) throw Error('Unavailable');
    const checked = Date.parse(stats.checkedAt); if(!Number.isFinite(checked) || checked > Date.now() + 60000) throw Error('Invalid date');
    byId('download-count').textContent = stats.totalDownloads.toLocaleString();
    byId('stats-status').textContent = `${Date.now() - checked > 5400000 ? 'Last known counts' : 'Updated'} ${new Date(checked).toLocaleString()}. Refreshes about every 30 minutes.`;
    for(const item of stats.versions) {
      if(!validVersion(item.version) || !Number.isSafeInteger(item.downloads) || item.downloads < 0) throw Error('Invalid count');
      const li = document.createElement('li'), version = document.createElement('span'), count = document.createElement('span');
      version.textContent = 'v' + item.version; count.textContent = item.downloads.toLocaleString(); li.append(version,count); byId('version-counts').append(li);
    }
    const current = stats.current;
    if(product.releaseReady === true && validVersion(product.version) && current && current.version === product.version && current.sha256 === product.sha256 && current.size === product.size && validVersion(current.version) && /^https:\/\/github\.com\/SlendermanHG\/slendystuff\.com\/releases\/download\/v[0-9.]+\/SlendyStuffClicker\.exe$/.test(current.url) && current.url.includes('/v' + current.version + '/') && /^[a-f0-9]{64}$/.test(current.sha256) && Number.isSafeInteger(current.size) && current.size > 0 && Date.now() - checked <= 5400000) {
      const link = byId('download'); link.href = current.url; link.removeAttribute('aria-disabled'); link.removeAttribute('tabindex');
      byId('download-version').textContent = 'v' + current.version;
      byId('release-status').textContent = `GitHub release · ${(current.size/1048576).toFixed(1)} MB · SHA-256: ${current.sha256}`;
    } else byId('release-status').textContent = 'The verified public download is not available yet. Check the release notes for news.';
  }).catch(() => {byId('download-count').textContent = '—';byId('stats-status').textContent = 'Download counts are temporarily unavailable.';byId('version-counts').replaceChildren();});
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
      byId('feedback-status').textContent = 'Thank you. Your feedback was accepted for delivery to Slender.';available = false;
    } catch {uncertain = true;byId('feedback-status').textContent = 'Delivery could not be confirmed. Please check with Slender before sending again.';}
  });
})();
