'use strict';
const fs=require('node:fs'),path=require('node:path');
const repository='SlendermanHG/slendystuff.com';
const releases=[
  {id:408611146,version:'0.5.1.0',size:1007616,hash:'eb5770592c6a5c2a2c1c6044775e5b5db1e8a8942663c7fac226ae7a8d540dd5'},
  {id:411004925,version:'0.5.2.0',size:1103360,hash:'b18a24248dc61e3dcbaa62613303679d9eddd182643d7eefb884832b11a68755'}
];
function verify(value,spec){
  const url='https://github.com/'+repository+'/releases/';
  if(!value||value.id!==spec.id||value.draft!==false||value.prerelease!==true||value.tag_name!=='v'+spec.version||value.html_url!==url+'tag/v'+spec.version||!Array.isArray(value.assets)||value.assets.length!==1)throw Error('Published release identity mismatch');
  const asset=value.assets[0];
  if(asset.name!=='SlendyStuffClicker.exe'||asset.state!=='uploaded'||asset.size!==spec.size||asset.digest!=='sha256:'+spec.hash||asset.browser_download_url!==url+'download/v'+spec.version+'/SlendyStuffClicker.exe')throw Error('Published asset identity mismatch');
}
async function synchronize(env,request=fetch){
  if(env.GITHUB_REPOSITORY!==repository||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!env.GITHUB_TOKEN)throw Error('Release-note synchronization requires the main push workflow');
  async function api(spec,method,body){
    const response=await request('https://api.github.com/repos/'+repository+'/releases/'+spec.id,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'SlendyStuff-release-notes','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw Error('Release-note request failed: '+response.status);
    return response.json();
  }
  // Only the body is editable here: no new release, draft publication, tag or EXE change.
  for(const spec of releases){
    const notes=fs.readFileSync(path.join(__dirname,'releases',spec.version,'RELEASE-NOTES.md'),'utf8');
    if(!notes.startsWith('# SlendyStuffClicker v'+spec.version+'\n')||!notes.includes(spec.hash)||Buffer.byteLength(notes)>32768)throw Error('Release-note version/identity mismatch');
    const before=await api(spec,'GET');verify(before,spec);
    if(before.body!==notes){const after=await api(spec,'PATCH',{body:notes});verify(after,spec);if(after.body!==notes)throw Error('Release-note update was not confirmed');}
    console.log('Release notes synchronized: v'+spec.version);
  }
}
module.exports={synchronize,verify,releases};
if(require.main===module)synchronize(process.env).catch(error=>{console.error(error.message);process.exitCode=1;});
