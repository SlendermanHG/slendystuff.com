import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDownloadStats,downloadStatsLimits} from './downloads.mjs';
import worker from './worker.js';

const product = {version:'0.5.2.0', size:1103360, releaseReady:true, sha256:'b18a24248dc61e3dcbaa62613303679d9eddd182643d7eefb884832b11a68755'};
const downloadUrl = version => `https://github.com/SlendermanHG/slendystuff.com/releases/download/v${version}/SlendyStuffClicker.exe`;
function asset(id, version, name = 'SlendyStuffClicker.exe', count = 0, size = 1103360) {
  return {id, name, state:'uploaded', digest:'sha256:'+product.sha256, download_count:count, size, browser_download_url:`https://github.com/SlendermanHG/slendystuff.com/releases/download/v${version}/${encodeURIComponent(name)}`};
}
function release(tag, assets = [], draft = false, prerelease = tag.includes('-')) { return {tag_name:tag, draft, prerelease, assets}; }
function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json',...headers}});
}
function fetchHarness(releases, {productValue = product, headersByPage = {}} = {}) {
  const requests = [];
  const fetcher = async (input, options) => {
    const url = new URL(input);
    requests.push({url:url.href, options});
    if (url.href === 'https://slendystuff.com/slendystuffclicker/product.json') return jsonResponse(productValue);
    assert.equal(url.origin,'https://api.github.com');
    assert.equal(url.pathname,'/repos/SlendermanHG/slendystuff.com/releases');
    assert.equal(url.searchParams.get('per_page'),'100');
    const page = Number(url.searchParams.get('page'));
    const values = releases[page - 1] ?? [];
    return jsonResponse(values, headersByPage[page] || {});
  };
  return {fetcher, requests};
}

test('aggregates published EXE asset counts, including previews and repeat downloads',async()=>{
  const {fetcher,requests} = fetchHarness([
    [
      release('v0.5.2.0',[asset(1,'0.5.2.0','SlendyStuffClicker.exe',23),asset(2,'0.5.2.0','checksums.txt',900)]),
      release('v0.5.1.0',[asset(3,'0.5.1.0','SlendyStuffClicker.exe',7,1007616)]),
      release('v0.4.0.0',[asset(4,'0.4.0.0','SlendyStuffClicker.exe',5)],false,true),
      release('v0.6.0.0-preview',[asset(5,'0.6.0.0-preview','SlendyStuffClicker.exe',99)]),
      release('v0.5.3.0',[asset(6,'0.5.3.0','SlendyStuffClicker.exe',4)],true)
    ]
  ]);
  const stats = await refreshDownloadStats({fetcher,now:()=>new Date('2026-10-13T00:00:00.000Z')});
  assert.deepEqual(stats,{status:'ok',checkedAt:'2026-10-13T00:00:00.000Z',totalDownloads:35,
    versions:[{version:'0.5.2.0',downloads:23},{version:'0.5.1.0',downloads:7},{version:'0.4.0.0',downloads:5}],
    current:{version:'0.5.2.0',url:downloadUrl('0.5.2.0'),sha256:product.sha256,size:product.size}});
  assert.equal(requests.length,2);
  assert.ok(requests.every(request => request.options.redirect === 'manual' && request.options.credentials === undefined && !request.options.headers.Cookie && !request.options.headers.Authorization));
  assert.equal(requests[0].url,'https://slendystuff.com/slendystuffclicker/product.json');
});

test('follows complete pagination and rejects an inconsistent partial page',async()=>{
  const first = Array.from({length:100},(_,index)=>release(`v1.${index}.0.0`));
  const {fetcher,requests} = fetchHarness([first,[release('v0.5.2.0',[asset(200,'0.5.2.0','SlendyStuffClicker.exe',2)])]],{
    headersByPage:{1:{link:'<https://api.github.com/repos/SlendermanHG/slendystuff.com/releases?per_page=100&page=2>; rel="next"'}}
  });
  assert.equal((await refreshDownloadStats({fetcher})).totalDownloads,2);
  assert.equal(requests.length,3);
  const partial = fetchHarness([[release('v0.5.2.0')]],{
    headersByPage:{1:{link:'<https://api.github.com/repos/SlendermanHG/slendystuff.com/releases?per_page=100&page=2>; rel="next"'}}
  });
  await assert.rejects(refreshDownloadStats({fetcher:partial.fetcher}),/Incomplete releases pagination/);
});

test('rejects duplicate release versions, duplicate assets and unsafe asset metadata',async()=>{
  for (const values of [
    [release('v0.5.2.0'),release('v0.5.2.0')],
    [release('v0.5.2.0',[asset(1,'0.5.2.0')]),release('v0.5.1.0',[asset(1,'0.5.1.0')])],
    [release('v0.5.2.0',[{...asset(1,'0.5.2.0'),download_count:-1}])],
    [release('v0.5.2.0',[{...asset(1,'0.5.2.0'),browser_download_url:'https://evil.example/file'}])]
  ]) {
    const {fetcher} = fetchHarness([values]);
    await assert.rejects(refreshDownloadStats({fetcher}));
  }
});

test('validates product metadata and never accepts an unexpected pagination target',async()=>{
  const invalidProduct = fetchHarness([[]],{productValue:{...product,size:'1103360'}});
  await assert.rejects(refreshDownloadStats({fetcher:invalidProduct.fetcher}),/Invalid product size/);
  const badPage = fetchHarness([Array.from({length:100},(_,index)=>release(`v1.${index}.0.0`))],{
    headersByPage:{1:{link:'<https://evil.example/releases?page=2>; rel="next"'}}
  });
  await assert.rejects(refreshDownloadStats({fetcher:badPage.fetcher}),/Unexpected pagination target/);
});

test('resource bounds stay finite; a full final page is verified with the next fixed endpoint',async()=>{
  assert.deepEqual(downloadStatsLimits,{pages:10,releases:1000,assets:5000,apiBytes:1048576,productBytes:8192,requestTimeoutMs:15000});
  const fullPage = fetchHarness([Array.from({length:100},(_,index)=>release(`v1.${index}.0.0`))]);
  assert.equal((await refreshDownloadStats({fetcher:fullPage.fetcher})).totalDownloads,0);
  assert.equal(fullPage.requests.length,3);
  const limit = fetchHarness(Array.from({length:10},(_,page)=>Array.from({length:100},(_,index)=>release(`v1.${page}.${index}.0`))));
  await assert.rejects(refreshDownloadStats({fetcher:limit.fetcher}),/Incomplete releases pagination/);
});

test('only an uploaded current EXE with the exact GitHub digest enables its download',async()=>{
  for(const change of [{digest:'sha256:'+'0'.repeat(64)},{digest:null},{digest:undefined},{size:product.size+1},{state:'starter'}]){
    const currentAsset={...asset(1,'0.5.2.0'),...change};const {fetcher}=fetchHarness([[release('v0.5.2.0',[currentAsset])]]);
    assert.equal((await refreshDownloadStats({fetcher})).current,null);
  }
});

test('upstream redirects are rejected without following or forwarding browser credentials',async()=>{
  let calls=0;
  await assert.rejects(refreshDownloadStats({fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.invalid'}});}}),/Upstream request failed: 302/);
  assert.equal(calls,1);
});

test('Worker serves exact same-origin GET and HEAD stats routes from its cache',async()=>{
  const body = JSON.stringify({status:'ok',source:'github',checkedAt:'2026-10-13T00:00:00.000Z',totalDownloads:1,versions:[{version:'0.5.2.0',downloads:1}],current:null});
  const cache = {match:async()=>new Response(body,{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300','Content-Length':String(new TextEncoder().encode(body).byteLength)}})};
  const env = {DOWNLOAD_CACHE:cache};
  const get = await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json'),env);
  assert.equal(get.status,200);
  assert.deepEqual(await get.json(),JSON.parse(body));
  assert.equal(get.headers.get('Cache-Control'),'public, max-age=300');
  const head = await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json',{method:'HEAD'}),env);
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
  assert.equal(head.headers.get('Content-Length'),String(new TextEncoder().encode(body).byteLength));
  assert.equal((await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json?x=1'),env)).status,404);
  assert.equal((await worker.fetch(new Request('http://slendystuff.com/stats/slendystuffclicker.json'),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json',{method:'POST'}),env)).headers.get('Allow'),'GET, HEAD');
  assert.equal((await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json',{headers:{Origin:'https://evil.example'}}),env)).status,403);
});

test('Worker does not turn expired cached values into success after refresh failure',async()=>{
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async()=>{throw new Error('synthetic upstream failure');};
  try {
    const response = await worker.fetch(new Request('https://slendystuff.com/stats/slendystuffclicker.json'),{
      DOWNLOAD_CACHE:{match:async()=>null,put:async()=>{throw new Error('must not cache');}}
    });
    assert.equal(response.status,503);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(response.headers.get('Retry-After'),'60');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
