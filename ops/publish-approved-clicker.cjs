'use strict';
// Publishes only the specific unsigned manual preview approved by the owner.
// It never builds code, handles future versions or changes the trusted-update gate.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const repo = 'SlendermanHG/slendystuff.com';
const tag = 'v0.5.1.0';
const name = 'SlendyStuffClicker.exe';
const hash = 'eb5770592c6a5c2a2c1c6044775e5b5db1e8a8942663c7fac226ae7a8d540dd5';
const size = 1007616;

function assembleApprovedBinary() {
  const root = path.join(__dirname, 'releases', '0.5.1.0');
  const binary = Buffer.concat([1,2,3,4].map(n => fs.readFileSync(path.join(root, name + '.part' + n))));
  if (binary.length !== size || crypto.createHash('sha256').update(binary).digest('hex') !== hash) throw Error('Unapproved publication parts');
  fs.writeFileSync(path.join(root, name), binary);
  return binary;
}

function verifyAsset(asset, draft = false) {
  const prefix = `https://github.com/${repo}/releases/download/`;
  const expected = prefix + tag + '/' + name;
  // GitHub gives draft assets an untagged URL until the release is published.
  const draftUrl = draft && typeof asset?.browser_download_url === 'string' && asset.browser_download_url.startsWith(prefix) &&
    /^untagged-[a-f0-9]{20}\/SlendyStuffClicker\.exe$/.test(asset.browser_download_url.slice(prefix.length));
  if (!asset || asset.name !== name || asset.size !== size || asset.state !== 'uploaded' || asset.digest !== 'sha256:' + hash ||
      (asset.browser_download_url !== expected && !draftUrl)) throw Error('Release asset does not match approval');
}

async function publish(env = process.env, request = fetch) {
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'push' ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || !env.GITHUB_TOKEN) throw Error('Approved main-branch publication context required');
  const root = path.join(__dirname, 'releases', '0.5.1.0');
  const binary = fs.readFileSync(path.join(root, name));
  const notes = fs.readFileSync(path.join(root, 'RELEASE-NOTES.md'), 'utf8').replace(/\r\n/g, '\n');
  if (binary.length !== size || crypto.createHash('sha256').update(binary).digest('hex') !== hash) throw Error('Unapproved binary');
  if (!notes.startsWith('# SlendyStuffClicker v0.5.1.0\n') || !notes.includes(hash)) throw Error('Missing approved version and identity in notes');
  const product = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'slendystuffclicker', 'product.json'), 'utf8'));
  if (product.version !== '0.5.1.0' || product.size !== size || product.sha256 !== hash || product.releaseReady !== true) throw Error('Website metadata mismatch');
  const base = `https://api.github.com/repos/${repo}`;
  async function api(url, method = 'GET', body, binaryBody = false, allow404 = false) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(parsed.hostname) ||
        !parsed.pathname.startsWith(`/repos/${repo}/`)) throw Error('Invalid GitHub endpoint');
    const response = await request(url, {method, redirect:'error', signal:AbortSignal.timeout(60000), headers:{
      Accept:'application/vnd.github+json', Authorization:'Bearer ' + env.GITHUB_TOKEN,
      'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':binaryBody ? 'application/octet-stream' : 'application/json',
      'User-Agent':'SlendyStuffClicker-approved-release'
    }, ...(body === undefined ? {} : {body:binaryBody ? body : JSON.stringify(body)})});
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub ${method} failed (${response.status}); publication stopped`);
    return response.json();
  }
  let release = await api(`${base}/releases/tags/${tag}`, 'GET', undefined, false, true);
  if (!release) release = await api(`${base}/releases`, 'POST', {tag_name:tag,target_commitish:env.GITHUB_SHA,
    name:'SlendyStuffClicker ' + tag + ' — Preview',body:notes,draft:true,prerelease:true,make_latest:'false'});
  if (release.tag_name !== tag || release.prerelease !== true || release.body.replace(/\r\n/g, '\n') !== notes ||
      !Number.isSafeInteger(release.id) || !Array.isArray(release.assets) || release.assets.length > 1) throw Error('Existing release differs from approval');
  if (release.assets.length === 0) {
    if (release.draft !== true || release.target_commitish !== env.GITHUB_SHA) throw Error('Cannot alter an existing published or unrelated release');
    const upload = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${name}`;
    verifyAsset(await api(upload, 'POST', binary, true), true);
  } else verifyAsset(release.assets[0], release.draft === true);
  // Read back uploaded identity before making the draft public. Never replace assets.
  release = await api(`${base}/releases/${release.id}`);
  if (release.assets.length !== 1) throw Error('Expected exactly one downloadable EXE');
  verifyAsset(release.assets[0], release.draft === true);
  if (release.draft) release = await api(`${base}/releases/${release.id}`, 'PATCH', {draft:false,prerelease:true,make_latest:'false'});
  if (release.draft !== false || release.tag_name !== tag || release.prerelease !== true || release.assets.length !== 1) throw Error('Public release not confirmed');
  verifyAsset(release.assets[0]);
  console.log('Verified approved public preview: ' + release.html_url);
  return release;
}
module.exports = {publish, verifyAsset, assembleApprovedBinary};
if (require.main === module) publish().catch(error => {console.error(error.message);process.exitCode = 1;});
