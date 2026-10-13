const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(__dirname+'/../public/slendystuffclicker/clicker.js','utf8');
function harness(){
 let now=Date.parse('2026-10-13T12:00:00Z'),fail=false,total=10,held=false,resolveHeld;
 const records=[],intervals=[],listeners={},nodes={};
 class Element{constructor(){this.attrs={};this.listeners={};this.children=[];this.textContent='';this.value='';}set href(v){this.attrs.href=v;}get href(){return this.attrs.href;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(k,fn){this.listeners[k]=fn;}replaceChildren(...v){this.children=v;}append(...v){this.children.push(...v);}reportValidity(){return false;}}
 const document={hidden:false,getElementById:id=>nodes[id]??=(new Element()),createElement:()=>new Element(),addEventListener:(k,fn)=>(listeners[k]??=[]).push(fn),dispatchEvent(){}};
 const hash='a'.repeat(64),product={version:'0.5.2.5',size:1135104,sha256:hash,releaseReady:true};
 const stats=()=>({status:'ok',source:'github',checkedAt:new Date(now).toISOString(),totalDownloads:total,versions:[{version:'0.5.2.5',downloads:total}],current:{...product,sha256:hash,size:1135104,url:'https://github.com/SlendermanHG/slendystuff.com/releases/download/v0.5.2.5/SlendyStuffClicker.exe'}});
 const fetcher=async url=>{records.push(url);if(url.includes('/stats/')){if(held)await new Promise(r=>resolveHeld=r);if(fail)throw Error('Synthetic outage');return new Response(JSON.stringify(stats()));}if(url.includes('product.json'))return new Response(JSON.stringify(product));if(url.includes('news.json'))return new Response(JSON.stringify({title:'News',message:'Message',date:'2026-10-13'}));return new Response(JSON.stringify({ready:false}));};
 const FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const ctx={document,fetch:fetcher,AbortController,TextDecoder,Uint8Array,Date:FakeDate,crypto:require('node:crypto').webcrypto,Event,setTimeout:()=>1,clearTimeout(){},setInterval:(fn,ms)=>intervals.push({fn,ms})};
 vm.runInNewContext(script,ctx);
 async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
 return {nodes,document,records,product,intervals,listeners,flush,advance:ms=>now+=ms,setCount:v=>total=v,setFailure:v=>fail=v,setHold:v=>held=v,releaseHold(){resolveHeld?.();held=false;}};
}
test('refresh replaces rows, updates real totals and leaves a failed refresh disabled',async()=>{
 const h=harness();await h.flush();assert(h.nodes.download.href);assert.equal(h.nodes['version-counts'].children.length,1);assert.equal(h.nodes['download-count'].textContent,'10');
 h.advance(300001);h.setCount(13);h.intervals[0].fn();await h.flush();assert.equal(h.nodes['download-count'].textContent,'13');assert.equal(h.nodes['version-counts'].children.length,1);
 h.advance(300001);h.setFailure(true);h.intervals[0].fn();await h.flush();assert.equal(h.nodes.download.href,undefined);assert.equal(h.nodes.download.attrs['aria-disabled'],'true');assert.equal(h.nodes['download-count'].textContent,'13');assert.match(h.nodes['stats-status'].textContent,/could not be refreshed/);
});
test('hidden pages do not poll; returning refreshes once and concurrent events coalesce',async()=>{
 const h=harness();await h.flush();const initial=h.records.length;h.document.hidden=true;h.advance(300001);h.intervals[0].fn();await h.flush();assert.equal(h.records.length,initial);
 h.document.hidden=false;h.setHold(true);h.listeners.visibilitychange[0]();h.listeners.visibilitychange[0]();h.intervals[0].fn();await h.flush();assert.equal(h.records.filter(v=>v.includes('/stats/')).length,2);
 h.releaseHold();await h.flush();assert(h.nodes.download.href);
});
test('expired verification blocks clicking even before a new poll; identity mismatch cannot enable',async()=>{
 const h=harness();await h.flush();h.advance(360001);let prevented=false;h.nodes.download.listeners.click({preventDefault(){prevented=true;}});assert(prevented);assert.equal(h.nodes.download.href,undefined);
 h.product.sha256='b'.repeat(64);h.intervals[0].fn();await h.flush();assert.equal(h.nodes.download.href,undefined);
});
