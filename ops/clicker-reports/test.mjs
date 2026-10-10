import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handle,ReportBudget,sanitizeDiagnostics,sanitizeFeedback} from './worker.js';
globalThis.crypto ??= webcrypto;
const report = () => ({schema:1,app:'SlendyStuffClicker',appVersion:'0.5.1.0',controllerProtocol:5,state:'stopped',currentSafetyCode:'none',logReadIncomplete:false,clicksThisRun:12,purchasesThisRun:3,events:[{event:'resource_sample',gameMiB:400.14,availableMemoryMiBBucket:999,secondsBeforeLatest:1.4}]});
function fixture(send=async()=>{}) {
  const data=new Map();let alarm, calls=[], chain=Promise.resolve();
  const storage={async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async setAlarm(v){alarm=v;},async deleteAll(){data.clear();}};
  const ctx={storage,blockConcurrencyWhile(fn){const result=chain.then(fn);chain=result.catch(()=>{});return result;}};
  const env={EMAIL:{async send(message){calls.push(message);return send(message);}},BURST:{async limit(){return {success:true};}}};
  const budget=new ReportBudget(ctx,env);env.BUDGET={idFromName:n=>n,get:n=>{assert.equal(n,'slendystuffclicker-mail-budget');return budget;}};
  return {env,budget,data,calls,get alarm(){return alarm;}};
}
const request=(body=report(),id='a'.repeat(32),path='diagnostics',headers={})=>new Request('https://reports.slendystuff.com/api/'+path,{method:'POST',headers:{'content-type':'application/json','X-Diagnostic-Submission':id,...headers},body:JSON.stringify(body)});
test('diagnostics reconstruct approved fields and reject invalid shape',()=>{
  const input=report();Object.assign(input,{username:'PRIVATE',email:'PRIVATE',path:'PRIVATE',save:'PRIVATE'});Object.assign(input.events[0],{key:'PRIVATE',absoluteTime:'PRIVATE',reason:'PRIVATE',message:'PRIVATE'});
  const clean=sanitizeDiagnostics(input);assert(!JSON.stringify(clean).includes('PRIVATE'));assert.equal(clean.events[0].availableMemoryMiBBucket,896);assert.equal(clean.events[0].gameMiB,400.1);
  for(const change of [{app:'other'},{appVersion:'0.05.1.0'},{clicksThisRun:Infinity},{events:Array(201).fill({event:'start'})},{controllerProtocol:6},{currentSafetyCode:'arbitrary text'}])assert.throws(()=>sanitizeDiagnostics({...report(),...change}));
  assert.throws(()=>sanitizeFeedback({category:'bug',message:'a'}));assert.throws(()=>sanitizeFeedback({category:'other',message:'x'.repeat(2001)}));
  assert.deepEqual(sanitizeFeedback({category:'bug',message:'  test feedback  ',recipient:'attacker@example.org'}),{category:'bug',message:'test feedback'});
});
test('fixed destination, privacy and deduplication',async()=>{
  const f=fixture(),input=report();input.ip='PRIVATE';input.events[0].raw='PRIVATE';
  assert.equal((await handle(request(input),f.env)).status,200);assert.equal(f.calls.length,1);
  const mail=f.calls[0];assert.equal(mail.to,'slender@slendystuff.com');assert.equal(mail.from,'diagnostics@slendystuff.com');assert(!JSON.stringify(mail).includes('PRIVATE'));
  assert.equal(mail.attachments[0].filename,'SlendyStuffClicker-diagnostics.json');assert.deepEqual(JSON.parse(atob(mail.attachments[0].content)),sanitizeDiagnostics(input));
  assert.equal((await handle(request(input),f.env)).status,200);assert.equal(f.calls.length,1);
  assert.equal((await handle(request({...input,clicksThisRun:13}),f.env)).status,409);
  assert(!JSON.stringify([...f.data.values()]).includes('gameMiB'),'Server quota stores hash and outcome, not report data');
});
test('concurrent duplicate cannot send two emails',async()=>{
  const f=fixture(async()=>new Promise(r=>setTimeout(r,10)));
  const result=await Promise.all([handle(request(),f.env),handle(request(),f.env)]);assert(result.every(r=>r.status===200));assert.equal(f.calls.length,1);
});
test('failed/ambiguous mail stays pending and cannot resend',async()=>{
  const f=fixture(async()=>{throw Error('PRIVATE credentials');});assert.equal((await handle(request(),f.env)).status,503);assert.equal((await handle(request(),f.env)).status,409);assert.equal(f.calls.length,1);
});
test('quota and rate limiting bound abuse',async()=>{
  const f=fixture();for(let i=0;i<5;i++)assert.equal((await handle(request(report(),i.toString(16).padStart(32,'0')),f.env)).status,200);
  assert.equal((await handle(request(report(),'6'.repeat(32)),f.env)).status,429);assert.equal(f.calls.length,5);
  const stored=f.data.get('budget');stored.attempts=100;stored.minuteAttempts=0;f.data.set('budget',stored);assert.equal((await handle(request(report(),'7'.repeat(32)),f.env)).status,429);
  f.env.BURST.limit=async()=>({success:false});assert.equal((await handle(request(),f.env)).status,429);
});
test('old alarm never clears a new day quota',async()=>{
  const f=fixture();await handle(request(),f.env);await f.budget.alarm();assert(f.data.has('budget'));
  const stored=f.data.get('budget');stored.day--;f.data.set('budget',stored);await f.budget.alarm();assert.equal(f.data.size,0);
});
test('route, origin, content, length and readiness guards',async()=>{
  const f=fixture();assert.equal((await handle(request(report(),'a'.repeat(32),'diagnostics',{origin:'https://evil.example'}),f.env)).status,403);
  assert.equal((await handle(request(report(),'a'.repeat(32),'diagnostics',{'content-type':'text/plain'}),f.env)).status,415);
  assert.equal((await handle(request(report(),'bad'),f.env)).status,400);
  assert.equal((await handle(new Request('https://reports.slendystuff.com/api/diagnostics'),f.env)).status,405);
  assert.equal((await handle(new Request('https://reports.slendystuff.com/api/execute'),f.env)).status,404);
  assert.equal((await handle(new Request('https://reports.slendystuff.com/api/health?x=1'),f.env)).status,404);
  assert.equal((await handle(request({huge:'x'.repeat(196609)}),f.env)).status,400);
  const cors=await handle(new Request('https://reports.slendystuff.com/api/feedback',{method:'OPTIONS',headers:{origin:'https://slendystuff.com'}}),f.env);assert.equal(cors.headers.get('access-control-allow-origin'),'https://slendystuff.com');
  assert.equal((await handle(new Request('https://reports.slendystuff.com/api/health'),{})).status,503);assert.equal(f.calls.length,0);
});
test('feedback only sends visitor text and fixed category to Slender',async()=>{
  const f=fixture();assert.equal((await handle(request({category:'suggestion',message:'Please add a setting.',to:'PRIVATE',deviceId:'PRIVATE'},'b'.repeat(32),'feedback'),f.env)).status,200);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].to,'slender@slendystuff.com');assert(!JSON.stringify(f.calls[0]).includes('PRIVATE'));assert(!f.calls[0].attachments);
});
