import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker, {normalizeEvent,upsert} from './worker.js';
import {DatabaseSync} from 'node:sqlite';
const payload = {event:'page_view',page:'/',source:'direct'};
function harness(options = {}) {
  const points = [];
  const env = {DB:{prepare:sql=>({bind:(...values)=>({run:async()=>{points.push({sql,values});}})})},EVENT_LIMIT:{limit:async()=>({success:options.allowed !== false})}};
  return {points,env};
}
function req(body = payload, extra = {}) {
  return new Request('https://slendystuff.com/__analytics',{method:'POST',headers:{Origin:'https://slendystuff.com','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.5',...extra},body:JSON.stringify(body)});
}
test('records only aggregate allowlisted dimensions, never identifiers',async()=>{
  const {env,points} = harness(); const response = await worker.fetch(req(),env);
  assert.equal(response.status,204);
  assert.deepEqual(points,[{sql:upsert,values:[new Date().toISOString().slice(0,10),'page_view','/','direct','']}]);
});
test('rejects arbitrary paths, free text, URLs, extra fields and invalid versions',async()=>{
  for(const data of [{...payload,page:'/r/secret'}, {...payload,page:'/?key=private'}, {...payload,email:'private@example.com'}, {...payload,event:'private text'}, {...payload,source:'https://private.example/'}, {...payload,event:'download_click',page:'/slendystuffclicker/',version:'bad'}]) assert.equal(normalizeEvent(data),null);
  assert.ok(normalizeEvent({event:'download_click',page:'/slendystuffclicker/',source:'social',version:'0.5.2.0'}));
});
test('origin, body size, malformed payload and rate limits are enforced',async()=>{
  const {env,points}=harness();
  assert.equal((await worker.fetch(req(payload,{Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await worker.fetch(req({...payload,event:'x'.repeat(2000)}),env)).status,413);
  assert.equal((await worker.fetch(req({...payload,page:'/stats/'}),env)).status,400);
  assert.equal((await worker.fetch(req(),harness({allowed:false}).env)).status,429);
  assert.equal(points.length,0);
});
test('privacy signals and EU countries skip storage',async()=>{
  const {env,points}=harness();
  for(const headers of [{DNT:'1'},{'Sec-GPC':'1'}]) assert.equal((await worker.fetch(req(payload,headers),env)).status,204);
  const european=req();Object.defineProperty(european,'cf',{value:{country:'DE'}});
  assert.equal((await worker.fetch(european,env)).status,204);assert.equal(points.length,0);
});
test('no-referrer POSTs work only with browser-controlled same-origin Fetch Metadata',async()=>{
  const {env,points}=harness();
  assert.equal((await worker.fetch(req(payload,{Origin:'null','Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors'}),env)).status,204);
  assert.equal((await worker.fetch(req(payload,{Origin:'null','Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors'}),env)).status,403);
  assert.equal((await worker.fetch(req(payload,{Origin:'null'}),env)).status,403);
  assert.equal(points.length,1);
});
test('redirects point to actual equivalent pages and drop query secrets',async()=>{
  for(const [old,target] of [['/index.html','/'],['/support.html','/contact.html'],['/catalog.html','/software.html'],['/slendystuffclicker/index.html','/slendystuffclicker/'],['/slendystuffclicker/setup/index.html','/slendystuffclicker/setup/']]){
    const response=await worker.fetch(new Request('https://slendystuff.com'+old+'?key=private'),{});
    assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://slendystuff.com'+target);
  }
  for(const old of ['/admin.html','/cart.html','/church.html']) assert.equal((await worker.fetch(new Request('https://slendystuff.com'+old),{})).status,404);
});
test('health exposes readiness only; no public analytics read endpoint',async()=>{
  const {env}=harness();
  assert.deepEqual(await (await worker.fetch(new Request('https://slendystuff.com/__analytics/health'),env)).json(),{ready:true});
  assert.equal((await worker.fetch(new Request('https://slendystuff.com/__analytics'),env)).status,405);
  assert.equal((await worker.fetch(req(),{})).status,503);
});
const source=fs.readFileSync(new URL('../../public/analytics.js',import.meta.url),'utf8');
function browserHarness({pathname='/', dnt='0', gpc=false, referrer='https://www.reddit.com/r/test?private=value', canonical='https://slendystuff.com/'}={}) {
  const requests=[],listeners={};
  const context={location:{hostname:'slendystuff.com',pathname,origin:'https://slendystuff.com'},navigator:{doNotTrack:dnt,globalPrivacyControl:gpc},document:{body:{dataset:{}},referrer,querySelector:()=>canonical ? {href:canonical} : null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{listeners[name]=fn;}},URL,fetch:async(url,options)=>{requests.push({url,...options});}};
  vm.runInNewContext(source,context);return {requests,listeners};
}
test('browser sends no URLs, query strings, cookies or referrer; counts download clicks separately',()=>{
  const {requests,listeners}=browserHarness({canonical:'https://slendystuff.com/slendystuffclicker/'});
  listeners.click({target:{closest:()=>({href:'https://github.com/SlendermanHG/slendystuff.com/releases/download/v0.5.2.0/SlendyStuffClicker.exe',getAttribute:()=>null})}});
  assert.equal(requests.length,2);assert.equal(requests[0].credentials,'omit');assert.equal(requests[0].referrerPolicy,'no-referrer');
  assert.deepEqual(JSON.parse(requests[0].body),{event:'page_view',page:'/slendystuffclicker/',source:'social'});
  assert.equal(JSON.parse(requests[1].body).event,'download_click');
});
test('browser privacy signals and non-public pages make no requests',()=>{
  for(const options of [{dnt:'1'},{gpc:true},{pathname:'/r/',canonical:null},{pathname:'/stats/',canonical:null}]) assert.equal(browserHarness(options).requests.length,0);
});
test('SQLite stores one counter per day/dimension and reports the real event funnel',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const statement=db.prepare(upsert),day=new Date().toISOString().slice(0,10);
  statement.run(day,'page_view','/slendystuffclicker/','direct','');
  statement.run(day,'page_view','/slendystuffclicker/','direct','');
  statement.run(day,'download_click','/slendystuffclicker/','direct','0.5.2.0');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM daily_events').get().n,2);
  const funnel=db.prepare('SELECT * FROM product_funnel_30_days').get();
  assert.equal(funnel.product_page_views,2);assert.equal(funnel.download_clicks,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM summary_30_days').get().n,2);
  db.close();
});
