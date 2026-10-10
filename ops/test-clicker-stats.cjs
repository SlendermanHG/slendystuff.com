const test=require('node:test'),assert=require('node:assert/strict');
const {summarize,refresh}=require('./refresh-clicker-stats.cjs');
const product={version:'0.5.1.0',sha256:'a'.repeat(64),size:100,releaseReady:true};
const release=(v='0.5.1.0',count=10)=>({tag_name:'v'+v,draft:false,prerelease:true,assets:[{name:'SlendyStuffClicker.exe',state:'uploaded',download_count:count,size:100,digest:'sha256:'+product.sha256,browser_download_url:`https://github.com/SlendermanHG/slendystuff.com/releases/download/v${v}/SlendyStuffClicker.exe`}]});
test('counts real EXE assets, includes previews and repeats, excludes drafts and other products',()=>{
  const draft={...release(),draft:true},other=release();other.assets[0].name='other.exe';
  const stats=summarize([release(),release('0.5.0.0',3),draft,other],product);assert.equal(stats.totalDownloads,13);assert.equal(stats.versions.length,2);assert.equal(stats.current.version,product.version);
  assert.equal(summarize([],product).totalDownloads,0);
});
test('published asset must match curated hash and size for download to open',()=>{
  assert.equal(summarize([release()],{...product,releaseReady:false}).current,null);
  const bad=release();bad.assets[0].digest='sha256:'+'b'.repeat(64);assert.equal(summarize([bad],product).current,null);
  bad.assets[0].size=101;bad.assets[0].digest='sha256:'+product.sha256;assert.equal(summarize([bad],product).current,null);
});
test('invalid counts and unexpected asset destinations fail rather than publish partial totals',()=>{
  for(const value of [-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>summarize([release('0.5.1.0',value)],product));
  const bad=release();bad.assets[0].browser_download_url='https://evil.example/download';assert.throws(()=>summarize([bad],product));
  assert.throws(()=>summarize([release(),release()],product));
});
test('pagination, authentication boundaries and API failures',async()=>{
  let calls=0;const fetcher=async(url,options)=>{calls++;assert(url.startsWith('https://api.github.com/repos/SlendermanHG/slendystuff.com/releases?'));assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fake-test-token');return new Response(JSON.stringify(calls===1?Array.from({length:50},(_,i)=>({...release(`0.4.${i}.0`,2)})):[release()]));};
  const stats=await refresh(fetcher,product,'fake-test-token');assert.equal(calls,2);assert.equal(stats.totalDownloads,110);
  await assert.rejects(refresh(async()=>new Response('{}',{status:403}),product));
  await assert.rejects(refresh(async()=>new Response(JSON.stringify(Array(50).fill(release()))),product));
});
