const API_URL = 'https://api.github.com/repos/SlendermanHG/slendystuff.com/releases';
const PRODUCT_URL = 'https://slendystuff.com/slendystuffclicker/product.json';
const DOWNLOAD_BASE = 'https://github.com/SlendermanHG/slendystuff.com/releases/download/';
const EXECUTABLE = 'SlendyStuffClicker.exe';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RELEASES = PAGE_SIZE * MAX_PAGES;
const MAX_ASSETS = 5000;
const MAX_API_BYTES = 1024 * 1024;
const MAX_PRODUCT_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 15000;
const versionPattern = /^v((?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){3})$/;

function versionOf(tag) {
  const match = versionPattern.exec(tag);
  if (!match) return null;
  const version = match[1];
  return version.split('.').every(part => Number(part) <= 65534) ? version : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response, maxBytes) {
  assert(response.ok, 'Upstream request failed: ' + response.status);
  const contentType = response.headers.get('content-type');
  assert(typeof contentType === 'string' && contentType.toLowerCase().startsWith('application/json'), 'Unexpected upstream content type');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    assert(/^\d+$/.test(contentLength) && Number(contentLength) <= maxBytes, 'Upstream response too large');
  }
  assert(response.body, 'Empty upstream response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      assert(length <= maxBytes, 'Upstream response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
}

function validateProduct(product) {
  assert(product && typeof product === 'object' && !Array.isArray(product), 'Invalid product metadata');
  assert(Object.keys(product).every(key => ['version','size','releaseReady','sha256'].includes(key)), 'Unexpected product metadata');
  assert(typeof product.version === 'string' && versionOf('v' + product.version) === product.version, 'Invalid product version');
  assert(Number.isSafeInteger(product.size) && product.size > 0 && product.size <= 67108864, 'Invalid product size');
  assert(typeof product.releaseReady === 'boolean', 'Invalid release readiness');
  assert(typeof product.sha256 === 'string' && /^[a-f0-9]{64}$/.test(product.sha256), 'Invalid product hash');
  return product;
}

function nextPageFromLink(header, page) {
  if (header === null) return null;
  assert(header.length <= 4096, 'Pagination header too large');
  const links = [...header.matchAll(/<([^<>]+)>\s*;\s*rel="?([^";\s]+)"?/g)];
  assert(header.trim() === '' || links.length > 0, 'Invalid pagination header');
  const next = links.filter(match => match[2] === 'next');
  assert(next.length <= 1, 'Duplicate pagination link');
  if (!next.length) return null;
  const url = new URL(next[0][1]);
  assert(url.protocol === 'https:' && url.origin === 'https://api.github.com' &&
    url.pathname === '/repos/SlendermanHG/slendystuff.com/releases' &&
    url.searchParams.get('per_page') === String(PAGE_SIZE) &&
    url.searchParams.get('page') === String(page + 1) &&
    [...url.searchParams.keys()].length === 2, 'Unexpected pagination target');
  return page + 1;
}

function validateAssetUrl(value, tag, name) {
  assert(typeof value === 'string' && value.length <= 2048, 'Invalid asset URL');
  const url = new URL(value);
  assert(url.protocol === 'https:' && url.hostname === 'github.com' &&
    url.username === '' && url.password === '' && url.search === '' && url.hash === '' &&
    url.pathname.startsWith('/SlendermanHG/slendystuff.com/releases/download/'), 'Invalid asset URL');
  if (name === EXECUTABLE) {
    const expected = DOWNLOAD_BASE + encodeURIComponent(tag) + '/' + encodeURIComponent(EXECUTABLE);
    assert(value === expected, 'Unexpected executable download URL');
  }
  return value;
}

export async function refreshDownloadStats({fetcher = fetch, now = () => new Date(), readToken} = {}) {
  assert(readToken === undefined || (typeof readToken === 'string' && /^github_pat_[A-Za-z0-9_]{40,255}$/.test(readToken)), 'Invalid read-only token configuration');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    const request = async (url, maxBytes, headers = {}) => {
      const response = await fetcher(url, {
        method:'GET',
        headers:{Accept:'application/vnd.github+json', 'User-Agent':'SlendyStuff-site-analytics', 'X-GitHub-Api-Version':'2022-11-28', ...headers},
        // Worker fetch has no browser cookie jar. Only explicit public headers are sent.
        // Manual redirects are rejected by the response status check; none are followed.
        redirect:'manual',
        signal:abort.signal
      });
      return readJson(response, maxBytes);
    };
    const product = validateProduct(await request(PRODUCT_URL, MAX_PRODUCT_BYTES, {Accept:'application/json'}));
    const releases = [];
    let page = 1;
    for (;;) {
      const url = `${API_URL}?per_page=${PAGE_SIZE}&page=${page}`;
      const response = await fetcher(url, {
        method:'GET',
        headers:{Accept:'application/vnd.github+json', 'User-Agent':'SlendyStuff-site-analytics', 'X-GitHub-Api-Version':'2022-11-28', ...(readToken ? {Authorization:'Bearer ' + readToken} : {})},
        redirect:'manual',
        signal:abort.signal
      });
      const values = await readJson(response, MAX_API_BYTES);
      assert(Array.isArray(values) && values.length <= PAGE_SIZE, 'Invalid releases page');
      releases.push({values, next:nextPageFromLink(response.headers.get('link'), page)});
      assert(releases.reduce((count, current) => count + current.values.length, 0) <= MAX_RELEASES, 'Too many releases');
      const last = releases[releases.length - 1];
      if (last.values.length < PAGE_SIZE) {
        assert(last.next === null, 'Incomplete releases pagination');
        break;
      }
      assert((last.next === null || last.next === page + 1) && page < MAX_PAGES, 'Incomplete releases pagination');
      // A complete last page can contain exactly PAGE_SIZE entries with no Link header.
      // Request the next fixed endpoint rather than guessing that a full page is final.
      page++;
    }

    const seenVersions = new Set();
    const seenAssetIds = new Set();
    const seenAssetNames = new Set();
    const byVersion = new Map();
    const assets = [];
    let assetCount = 0;
    for (const releasePage of releases) {
      for (const release of releasePage.values) {
        assert(release && typeof release === 'object' && !Array.isArray(release), 'Invalid release');
        assert(typeof release.draft === 'boolean', 'Invalid release draft flag');
        assert(typeof release.prerelease === 'boolean', 'Invalid release preview flag');
        assert(typeof release.tag_name === 'string' && release.tag_name.length > 0 && release.tag_name.length <= 128, 'Invalid release tag');
        assert(Array.isArray(release.assets), 'Invalid release assets');
        assetCount += release.assets.length;
        assert(assetCount <= MAX_ASSETS, 'Too many release assets');
        const version = versionOf(release.tag_name);
        if (!release.draft && version) {
          assert(!seenVersions.has(version), 'Duplicate release version');
          seenVersions.add(version);
        }
        for (const asset of release.assets) {
          assert(asset && typeof asset === 'object' && !Array.isArray(asset), 'Invalid release asset');
          assert(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid asset id');
          assert(typeof asset.name === 'string' && asset.name.length > 0 && asset.name.length <= 255, 'Invalid asset name');
          assert(Number.isSafeInteger(asset.download_count) && asset.download_count >= 0, 'Invalid asset download count');
          assert(Number.isSafeInteger(asset.size) && asset.size >= 0, 'Invalid asset size');
          validateAssetUrl(asset.browser_download_url, release.tag_name, asset.name);
          assert(!seenAssetIds.has(asset.id), 'Duplicate release asset');
          seenAssetIds.add(asset.id);
          const assetKey = release.tag_name + '\0' + asset.name;
          assert(!seenAssetNames.has(assetKey), 'Duplicate release asset');
          seenAssetNames.add(assetKey);
          if (!release.draft && version && asset.name === EXECUTABLE && asset.state === 'uploaded') {
            const item = {version, downloads:asset.download_count};
            byVersion.set(version, item);
            assert(asset.size > 0 && asset.size <= 67108864, 'Invalid executable size');
            assets.push({...item, size:asset.size, url:asset.browser_download_url, digest:asset.digest});
          }
        }
      }
    }
    const versions = [...byVersion.values()].sort((a, b) => {
      const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number);
      for (let index = 0; index < 4; index++) if (left[index] !== right[index]) return right[index] - left[index];
      return 0;
    });
    const totalDownloads = versions.reduce((total, item) => {
      const next = total + item.downloads;
      assert(Number.isSafeInteger(next), 'Download total overflow');
      return next;
    }, 0);
    const currentAsset = assets.find(asset => asset.version === product.version);
    const current = product.releaseReady && currentAsset && currentAsset.size === product.size && currentAsset.digest === 'sha256:' + product.sha256
      ? {version:product.version, url:currentAsset.url, sha256:product.sha256, size:product.size}
      : null;
    const checkedAt = now().toISOString();
    const result = {status:'ok', checkedAt, totalDownloads, versions, current};
    assert(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 65000, 'Download response too large');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export const downloadStatsLimits = Object.freeze({
  pages:MAX_PAGES,
  releases:MAX_RELEASES,
  assets:MAX_ASSETS,
  apiBytes:MAX_API_BYTES,
  productBytes:MAX_PRODUCT_BYTES,
  requestTimeoutMs:REQUEST_TIMEOUT_MS
});
