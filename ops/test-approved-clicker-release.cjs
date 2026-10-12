'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {publish, verifyAsset, assembleApprovedBinary} = require('./publish-approved-clicker.cjs');
const env = {GITHUB_REPOSITORY:'SlendermanHG/slendystuff.com',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_SHA:'a'.repeat(40),GITHUB_TOKEN:'test-fixture-token'};
const notes = fs.readFileSync(__dirname + '/releases/0.5.2.0/RELEASE-NOTES.md','utf8').replace(/\r\n/g,'\n');
const asset = {name:'SlendyStuffClicker.exe',size:1103360,state:'uploaded',digest:'sha256:b18a24248dc61e3dcbaa62613303679d9eddd182643d7eefb884832b11a68755',browser_download_url:'https://github.com/SlendermanHG/slendystuff.com/releases/download/v0.5.2.0/SlendyStuffClicker.exe'};
const release = {id:123,tag_name:'v0.5.2.0',prerelease:true,draft:true,body:notes,assets:[],target_commitish:env.GITHUB_SHA,html_url:'https://github.com/SlendermanHG/slendystuff.com/releases/tag/v0.5.2.0'};
test('Publication parts reconstruct the exact approved binary',()=>{ assert.equal(assembleApprovedBinary().length,1103360); });
function mock(sequence) {
  const calls=[];
  const request=async(url,options)=>{calls.push({url,options});const next=sequence.shift();assert.ok(next,'Unexpected network request');assert.equal(options.method,next.method);return {ok:next.status!==404,status:next.status||200,json:async()=>structuredClone(next.value)};};
  return {request,calls,sequence};
}
test('Only the exact owner-approved main push can publish',async()=>{
  for(const change of [{GITHUB_REF:'refs/heads/unapproved'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_SHA:'bad'},{GITHUB_TOKEN:''}]) {
    await assert.rejects(publish({...env,...change},()=>{throw Error('Must not request');}),/context required/);
  }
});
test('Asset digest, size, state, name and URL must match',()=>{
  for(const change of [{digest:'sha256:'+'b'.repeat(64)},{size:1},{state:'starter'},{name:'Other.exe'},{browser_download_url:'https://evil.invalid/file.exe'}]) assert.throws(()=>verifyAsset({...asset,...change}));
});
test('Creates draft, uploads exact bytes, reads identity back before publishing with notes',async()=>{
  const uploaded={...release,assets:[asset]},publicRelease={...uploaded,draft:false};
  const m=mock([{method:'GET',status:404},{method:'POST',value:release},{method:'POST',value:asset},{method:'GET',value:uploaded},{method:'PATCH',value:publicRelease}]);
  const result=await publish(env,m.request);assert.equal(result.draft,false);assert.equal(m.sequence.length,0);
  const creation=JSON.parse(m.calls[1].options.body);assert.equal(creation.body,notes);assert.equal(creation.draft,true);assert.equal(creation.prerelease,true);
  assert.equal(m.calls[2].options.body.length,1103360);assert.equal(m.calls[2].options.redirect,'error');
});
test('Exact published release is verified without any mutation',async()=>{
  const r={...release,draft:false,assets:[asset]};const m=mock([{method:'GET',value:r},{method:'GET',value:r}]);
  await publish(env,m.request);assert.ok(m.calls.every(c=>c.options.method==='GET'));
});
test('Different existing notes or extra assets stop without replacing anything',async()=>{
  for(const change of [{body:'Different release'},{assets:[asset,asset]},{assets:[{...asset,size:1}]}]) {
    const m=mock([{method:'GET',value:{...release,...change}}]);await assert.rejects(publish(env,m.request));assert.equal(m.calls.length,1);
  }
});
test('Bad upload identity never publishes',async()=>{
  const m=mock([{method:'GET',value:release},{method:'POST',value:{...asset,digest:'unknown'}}]);
  await assert.rejects(publish(env,m.request),/match approval/);assert.equal(m.calls.length,2);
});
test('GitHub untagged draft URL is accepted only before publishing; public URL must use exact version',async()=>{
  const draftAsset={...asset,browser_download_url:'https://github.com/SlendermanHG/slendystuff.com/releases/download/untagged-6488b2f2ab2f1a059392/SlendyStuffClicker.exe'};
  verifyAsset(draftAsset,true);assert.throws(()=>verifyAsset(draftAsset,false));
  const d={...release,assets:[draftAsset]},p={...release,draft:false,assets:[asset]};
  const m=mock([{method:'GET',value:d},{method:'GET',value:d},{method:'PATCH',value:p}]);await publish(env,m.request);
  assert.equal(m.calls.length,3);assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
});
