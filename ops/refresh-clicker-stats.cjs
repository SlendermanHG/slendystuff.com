const fs = require('node:fs/promises'), path = require('node:path');
const REPO = 'SlendermanHG/slendystuff.com', ASSET = 'SlendyStuffClicker.exe';
const version = value => typeof value === 'string' && /^v(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){3}$/.test(value) && value.slice(1).split('.').every(n=>+n<=65534);
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
const compare = (a,b) => {const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<4;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;};
function summarize(releases, product, checkedAt = new Date().toISOString()) {
  let total = 0, current = null; const versions = [], seen = new Set();
  if(!version('v' + product.version) || !/^[a-f0-9]{64}$/.test(product.sha256) || !Number.isSafeInteger(product.size) || product.size <= 0) throw Error('Invalid product metadata');
  for (const release of releases) {
    if(release.draft !== false || !version(release.tag_name) || !Array.isArray(release.assets)) continue;
    const assets = release.assets.filter(asset => asset.name === ASSET && asset.state === 'uploaded');
    if(!assets.length) continue;
    if(assets.length !== 1 || seen.has(release.tag_name)) throw Error('Ambiguous release');
    seen.add(release.tag_name); const asset = assets[0];
    const expected = `https://github.com/${REPO}/releases/download/${release.tag_name}/${ASSET}`;
    if(asset.browser_download_url !== expected || !safeCount(asset.download_count) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 52428800) throw Error('Invalid release asset');
    if(!Number.isSafeInteger(total + asset.download_count)) throw Error('Counter overflow');
    total += asset.download_count; const item = {version:release.tag_name.slice(1),downloads:asset.download_count}; versions.push(item);
    if(product.releaseReady === true && item.version === product.version && asset.size === product.size && asset.digest === 'sha256:' + product.sha256)
      current = {version:product.version,url:expected,sha256:product.sha256,size:product.size};
  }
  versions.sort((a,b)=>compare(a.version,b.version));
  return {status:'ok',checkedAt,totalDownloads:total,versions,current};
}
async function readPage(fetcher, page, token) {
  const headers = {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SlendyStuffClicker-download-counts'};
  if(token) headers.Authorization = 'Bearer ' + token;
  const response = await fetcher(`https://api.github.com/repos/${REPO}/releases?per_page=50&page=${page}`,{headers,redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok || +response.headers.get('content-length') > 2097152) throw Error('Release API unavailable');
  const reader = response.body.getReader();let bytes = 0, parts = [];
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>2097152)throw Error('Release body limit');parts.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});}
  const body=Buffer.concat(parts.map(p=>Buffer.from(p)),bytes); const result=JSON.parse(body.toString('utf8'));
  if(!Array.isArray(result) || result.length > 50) throw Error('Invalid release list');return result;
}
async function refresh(fetcher, product, token='') {
  const releases=[];
  for(let page=1;page<=20;page++) {const batch=await readPage(fetcher,page,token);releases.push(...batch);if(batch.length<50)return summarize(releases,product);}
  throw Error('Release pagination limit; refuse partial counts');
}
async function main() {
  const root=path.join(__dirname,'..'), destination=path.join(root,'public','stats','slendystuffclicker.json'); let stats;
  try {const product=JSON.parse(await fs.readFile(path.join(root,'public','slendystuffclicker','product.json'),'utf8'));stats=await refresh(fetch,product,process.env.GITHUB_TOKEN || '');}
  catch {stats={status:'unavailable',checkedAt:new Date().toISOString(),totalDownloads:null,versions:[],current:null};process.stderr.write('GitHub download counts unavailable; no partial or invented count published.\n');}
  await fs.writeFile(destination,JSON.stringify(stats,null,2)+'\n');
}
module.exports={summarize,refresh};if(require.main===module)main().catch(()=>{process.stderr.write('Could not write public download counts.\n');process.exitCode=1;});
