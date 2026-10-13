(() => {
  'use strict';
  if(location.hostname !== 'slendystuff.com' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  const canonical = document.querySelector('link[rel="canonical"]');
  const page = document.body.dataset.page === '404' ? '/404.html' : canonical ? new URL(canonical.href).pathname : location.pathname;
  const pages = new Set(['/', '/about.html', '/services.html', '/software.html', '/community.html', '/contact.html', '/slendystuffclicker/', '/slendystuffclicker/setup/', '/404.html']);
  if(!pages.has(page)) return;
  let source = 'direct';
  try {
    if(document.referrer) {
      const host = new URL(document.referrer).hostname;
      source = host === 'slendystuff.com' || host === 'www.slendystuff.com' ? 'site' : /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(host) ? 'search' : /(^|\.)(reddit\.com|youtube\.com|youtu\.be|twitch\.tv|facebook\.com|instagram\.com|t\.co|x\.com|discord\.com)$/.test(host) ? 'social' : 'other';
    }
  } catch {source = 'other';}
  let count = 0;
  function send(event, extra = {}) {
    if(count++ >= 15) return;
    fetch('/__analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,page,source,...extra}),credentials:'omit',referrerPolicy:'no-referrer',keepalive:true}).catch(() => {});
  }
  send('page_view');
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]'); if(!link || link.getAttribute('aria-disabled') === 'true') return;
    let target; try {target = new URL(link.href);} catch {return;}
    const match = target.hostname === 'github.com' && target.pathname.match(/^\/SlendermanHG\/slendystuff\.com\/releases\/download\/v(\d{1,5}(?:\.\d{1,5}){3})\/SlendyStuffClicker\.exe$/);
    if(match && page === '/slendystuffclicker/') send('download_click',{version:match[1]});
    else if(target.origin === location.origin && target.pathname === '/slendystuffclicker/setup/' && page === '/slendystuffclicker/') send('setup_click');
  });
  document.querySelectorAll('video').forEach(video => {
    const recorded = new Set();
    const once = name => {if(!recorded.has(name)){recorded.add(name);send(name);}};
    video.addEventListener('play',() => once('video_play'));
    video.addEventListener('timeupdate',() => {
      if(!Number.isFinite(video.duration) || video.duration <= 0) return;
      for(const threshold of [25,50,75]) if(video.currentTime / video.duration >= threshold / 100) once('video_' + threshold);
    });
    video.addEventListener('ended',() => once('video_complete'));
  });
  document.addEventListener('slendystuff:feedback-accepted',() => send('feedback_accepted'),{once:true});
})();
