'use strict';

// A weboldal data fájljainak olvasása. Élesben a weboldal git repójából
// (GitHub API), fejlesztésnél a helyi projektmappa shared/data mappájából.
// Csak olvas: a szerkesztett értékek a tárolóban (SITE_DATA_DIR) élnek, a
// fájlokból a szerkezet (mely oldalak és mezők léteznek) származik.
//
// Az eredmény rövid ideig gyorsítótárazódik, hogy a /site minden betöltése ne
// menjen ki a GitHubra; a hiba is cache-elődik, hogy ne terhelje a kvótát.

const fs = require('node:fs/promises');
const path = require('node:path');

function webSources({git, projectDir, cacheMs = 60000, now = Date.now} = {}) {
  const root = projectDir ? path.resolve(projectDir) : '';
  let cache = null;

  async function readLocal() {
    const dir = path.join(root,'shared','data');
    let names;
    try { names = await fs.readdir(dir); }
    catch (_) { return {source:'local',files:[],reason:'a data mappa nem érhető el'}; }
    const files = [];
    for (const name of names.filter(item => /\.txt$/i.test(item)).sort()) {
      try { files.push({file:name,text:await fs.readFile(path.join(dir,name),'utf8')}); }
      catch (_) { /* az olvashatatlan fájlt kihagyjuk */ }
    }
    return {source:'local',files};
  }

  async function readGitHub() {
    const entries = await git.listDataFiles('shared/data');
    const files = [];
    const failed = [];
    // Egy olvashatatlan fájl ne akassza meg a többit: a hibás fájlt kihagyjuk,
    // a többi oldal így is frissül.
    for (const entry of entries) {
      try { files.push({file:entry.name,text:await git.readTextFile(entry.path)}); }
      catch (_) { failed.push(entry.name); }
    }
    return {source:'github',files,failed};
  }

  async function read() {
    if (git && git.status().configured) return readGitHub();
    if (root) return readLocal();
    return {source:'none',files:[],missing:['SITE_GITHUB_REPO','SITE_GITHUB_TOKEN']};
  }

  async function load() {
    const stamp = now();
    if (cache && cache.expires > stamp) return cache.value;
    let value;
    try {
      value = await read();
    } catch (error) {
      value = {source:'error',files:[],error:error.message || String(error)};
    }
    cache = {expires:stamp + Math.max(Number(cacheMs) || 0,0),value};
    return value;
  }

  return {load,clear(){cache = null;}};
}

module.exports = {webSources};
