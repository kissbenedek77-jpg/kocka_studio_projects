'use strict';

// GitHub-alapú publikálás a weboldal repójába.
//
// A /site oldal szerkesztett tartalmát (shared/data/*.txt, shared/js/projects.js)
// egyetlen commitban írja a megadott repó adott branchére a Git Data API-val.
// A Railway a repóra kötött szolgáltatást ezután automatikusan újratelepíti.
// Helyi fájlrendszert nem használ, ezért Railway-en is működik.
//
// Változók:
//   SITE_GITHUB_REPO    owner/name (kötelező)
//   SITE_GITHUB_TOKEN   fine-grained vagy klasszikus token, contents: write (kötelező)
//   SITE_GITHUB_BRANCH  branch, alapérték main
//   SITE_GITHUB_PATH    opcionális mappa-előtag a repón belül
//   SITE_GITHUB_API_URL opcionális, alapérték https://api.github.com
//
// A token soha nem kerül naplóba vagy hibaüzenetbe.

const DEFAULT_API = 'https://api.github.com';
const fail = (message, status = 502) => Object.assign(new Error(message), {status});
const AUTH_ERROR = /bad credentials|requires authentication|not authorized|forbidden|resource not accessible/i;

function gitPublisher({
  token, repo, branch, pathPrefix, apiUrl, timeout = 20000, fetchImpl
} = {}) {
  const api = String(apiUrl || DEFAULT_API).replace(/\/+$/, '');
  const target = String(repo || '').trim();
  const head = String(branch || 'main').trim() || 'main';
  const prefix = String(pathPrefix || '').replace(/^\/+|\/+$/g, '');
  const missing = [];
  if (!token) missing.push('SITE_GITHUB_TOKEN');
  if (!/^[^/\s]+\/[^/\s]+$/.test(target)) missing.push('SITE_GITHUB_REPO');

  // A branch per-jelét meg kell őrizni az URL-ben, ezért szegmensenként kódolunk.
  const refPath = head.split('/').map(encodeURIComponent).join('/');

  function status() {
    return {
      configured: missing.length === 0,
      missing: missing.slice(),
      repo: target,
      branch: head,
      path: prefix,
      api
    };
  }

  async function request(method, endpoint, body) {
    const send = fetchImpl || globalThis.fetch;
    if (typeof send !== 'function')
      throw fail('A szerveren nincs elérhető fetch a GitHub-híváshoz.');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const seconds = Math.max(Number(timeout) || 0, 0);
    const timer = controller && seconds ? setTimeout(() => controller.abort(), seconds) : null;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kocka-studio-website'
    };
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await send(api + endpoint, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        throw fail('A GitHub API nem válaszolt időben (' + Math.round(seconds / 1000) + ' s).', 504);
      throw fail('A GitHub API nem érhető el: ' +
        (error && error.message ? error.message : 'hálózati hiba'));
    } finally {
      if (timer) clearTimeout(timer);
    }

    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_) { payload = null; }
    const message = payload && payload.message ? String(payload.message) : '';

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404 ||
          AUTH_ERROR.test(message))
        throw Object.assign(new Error('A GitHub nem fogadta el a kérést (HTTP ' + response.status + '). ' +
          'Ellenőrizd a SITE_GITHUB_TOKEN jogosultságát (contents: write) és a SITE_GITHUB_REPO ' +
          'beállítást.' + (message ? ' ' + message : '')), {status:502, auth:true});
      throw fail('A GitHub API hibát adott (HTTP ' + response.status + ').' +
        (message ? ' ' + message : ''));
    }
    return payload || {};
  }

  async function publish(files, message) {
    const state = status();
    if (!state.configured)
      throw fail('A GitHub publikálás nincs beállítva. Hiányzó változó: ' +
        state.missing.join(', ') + '.', 503);
    const list = (files || []).filter(file => file && file.path && typeof file.text === 'string');
    if (!list.length) throw fail('Nincs publikálható szöveges fájl.', 400);

    const ref = await request('GET', '/repos/' + target + '/git/ref/heads/' + refPath);
    const parent = ref.object && ref.object.sha;
    if (!parent) throw fail('A megadott branch nem található: ' + head);
    const base = await request('GET', '/repos/' + target + '/git/commits/' + parent);
    const baseTree = (base.tree && base.tree.sha) || '';

    const entries = [];
    for (const file of list) {
      const blob = await request('POST', '/repos/' + target + '/git/blobs', {
        content: Buffer.from(file.text, 'utf8').toString('base64'),
        encoding: 'base64'
      });
      if (!blob.sha) throw fail('A GitHub nem adott vissza blob-azonosítót.');
      entries.push({
        path: prefix ? prefix + '/' + file.path : file.path,
        mode: '100644', type: 'blob', sha: blob.sha
      });
    }

    const tree = await request('POST', '/repos/' + target + '/git/trees', baseTree
      ? {base_tree: baseTree, tree: entries} : {tree: entries});
    if (!tree.sha) throw fail('A GitHub nem adott vissza fa-azonosítót.');
    const commit = await request('POST', '/repos/' + target + '/git/commits', {
      message: String(message || 'Weboldal tartalom frissítése'),
      tree: tree.sha,
      parents: [parent]
    });
    if (!commit.sha) throw fail('A GitHub nem adott vissza commit-azonosítót.');
    await request('PATCH', '/repos/' + target + '/git/refs/heads/' + refPath, {
      sha: commit.sha, force: false
    });

    return {commit: commit.sha, files: entries.map(entry => entry.path)};
  }

  // A data mappa szöveges fájljai (a weboldal tartalmi forrásai).
  async function listDataFiles(dir = 'shared/data') {
    const state = status();
    if (!state.configured)
      throw fail('A GitHub nincs beállítva. Hiányzó változó: '+state.missing.join(', ')+'.',503);
    const folder = String(dir || 'shared/data').replace(/^\/+|\/+$/g,'');
    const base = prefix ? prefix+'/'+folder : folder;
    const tree = await request('GET','/repos/'+target+'/git/trees/'+refPath+'?recursive=1');
    const entries = Array.isArray(tree.tree) ? tree.tree : [];
    return entries
      .filter(entry => entry && entry.type === 'blob' && entry.path &&
        entry.path.startsWith(base+'/') && /\.txt$/i.test(entry.path))
      .map(entry => ({path:entry.path,name:entry.path.split('/').pop()}))
      .sort((a,b) => a.name.localeCompare(b.name,'hu'));
  }

  // Egy szöveges fájl tartalma a repóból.
  async function readTextFile(filePath) {
    const state = status();
    if (!state.configured)
      throw fail('A GitHub nincs beállítva. Hiányzó változó: '+state.missing.join(', ')+'.',503);
    const encoded = String(filePath || '').split('/').map(encodeURIComponent).join('/');
    const data = await request('GET','/repos/'+target+'/contents/'+encoded+
      '?ref='+encodeURIComponent(head));
    if (!data || data.type !== 'file' || typeof data.content !== 'string')
      throw fail('A fájl nem olvasható a repóból: '+filePath,404);
    return Buffer.from(data.content.replace(/\s+/g,''),'base64').toString('utf8');
  }

  return {status, publish, listDataFiles, readTextFile};
}

module.exports = {gitPublisher, DEFAULT_API};
