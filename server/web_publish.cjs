'use strict';

// A weboldal-kezelő „publikálása”.
//
// Két célpont lehetséges:
//  1. GitHub repó (éles használat): a szövegeket (shared/data/*.txt) és a
//     projektlistát (shared/js/projects.js) egy commitban a weboldal repójába
//     írja. A feltöltött képek nem kerülnek a repóba: a szerver /media/web/
//     útvonalán érhetők el, ezért abszolút URL-lel szerepelnek.
//  2. Helyi mappa (csak fejlesztés): ha a WEB_PROJECT_DIR be van állítva, a
//     fájlok a weboldal projekt mappájába íródnak, a képek pedig a shared/img
//     alá másolódnak.
//
// A művelet csak a várt fájlokat írja; a célmappán kívülre nem nyúl.

const fs = require('node:fs/promises');
const path = require('node:path');
const {exportPageTxt,exportProjectsJs,PUBLIC_BASE} = require('./web_content.cjs');

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const safeId = value => String(value || '').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,90);

// A nyilvános oldal abszolút kép-URL-jét visszaalakítja a shared/ mappára
// mutató relatív útvonallá (a projects.js a shared/js mappában van).
function relativeImage(src) {
  const value = String(src || '');
  if (!value) return '';
  if (value.startsWith(PUBLIC_BASE)) return '..'+value.slice(PUBLIC_BASE.length);
  return value;
}

// A szerveren tárolt feltöltött kép abszolút, nyilvános URL-je.
function mediaUrl(src) {
  const value = String(src || '');
  if (!value) return '';
  if (value.startsWith('/')) return PUBLIC_BASE + value;
  return value;
}

function webPublisher({store,projectDir,git}) {
  const root = projectDir ? path.resolve(projectDir) : '';

  // A felületnek: hova publikálunk, és ha nem megy, mi hiányzik.
  async function status() {
    if (git) {
      const state = git.status();
      if (state.configured)
        return {configured:true,target:'github',repo:state.repo,branch:state.branch,
          path:state.path,reason:''};
      if (!root)
        return {configured:false,target:'none',missing:state.missing,
          reason:'nincs beállítva'};
    }
    if (!root)
      return {configured:false,target:'none',
        missing:['SITE_GITHUB_REPO','SITE_GITHUB_TOKEN'],reason:'nincs beállítva'};
    try {
      await fs.access(path.join(root,'shared','data'));
      return {configured:true,target:'local',path:root,reason:''};
    } catch (_) {
      return {configured:false,target:'local',path:root,reason:'a mappa nem érhető el'};
    }
  }

  // A szöveges fájlok közös előállítása. GitHubhoz a feltöltött képek abszolút
  // URL-t kapnak, helyi módban a shared/img alá másolt fájlokra mutatnak.
  function textFiles(content,prepared) {
    const files = [];
    for (const page of content.pages) {
      const name = String(page.file || page.id).replace(/[^a-z0-9_-]/gi,'') || page.id;
      files.push({path:'shared/data/'+name+'.txt',text:exportPageTxt(page)});
    }
    files.push({path:'shared/js/projects.js',text:exportProjectsJs(prepared)});
    return files;
  }

  async function publishGitHub() {
    const content = await store.load();
    const prepared = content.projects.map(project => ({
      ...project,
      images: project.images.map(image => {
        const thumb = image.thumb || image.src;
        return {...image,
          src: String(image.src||'').startsWith('/') ? mediaUrl(image.src) : image.src,
          thumb: String(thumb||'').startsWith('/') ? mediaUrl(thumb) : thumb};
      })
    }));
    const files = textFiles(content,prepared);
    const result = await git.publish(files,'Weboldal tartalom frissítése a Kocka Stúdió kezelőből');
    return {target:'github',repo:git.status().repo,branch:git.status().branch,
      files:result.files,images:0,commit:result.commit};
  }

  async function writeFile(file,text,files) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp = file+'.tmp';
    await fs.writeFile(temp,text,'utf8');
    await fs.rename(temp,file);
    files.push(path.relative(root,file));
  }

  async function publishLocal() {
    const shared = path.join(root,'shared');
    const dataDir = path.join(shared,'data');
    const jsDir = path.join(shared,'js');
    const imagesRoot = path.join(shared,'img','projects');
    try { await fs.access(dataDir); }
    catch (_) { throw fail('A weboldal projekt nem található: '+root,500); }

    const content = await store.load();
    const files = [];
    let copied = 0;

    for (const page of content.pages) {
      const name = String(page.file || page.id).replace(/[^a-z0-9_-]/gi,'') || page.id;
      await writeFile(path.join(dataDir,name+'.txt'),exportPageTxt(page),files);
    }

    const prepared = [];
    for (const project of content.projects) {
      const id = safeId(project.id);
      const images = [];
      for (const image of project.images) {
        let src = relativeImage(image.src);
        let thumb = relativeImage(image.thumb || image.src);
        const isUpload = image.source === 'upload' && String(image.src).startsWith('/media/web/');
        if (isUpload) {
          const relative = String(image.src).slice('/media/web/'.length);
          const source = store.mediaFile(relative);
          const name = path.basename(relative);
          const target = path.join(imagesRoot,id,name);
          const thumbRelative = String(image.thumb || '').startsWith('/media/web/')
            ? String(image.thumb).slice('/media/web/'.length) : relative;
          const thumbSource = store.mediaFile(thumbRelative);
          await fs.mkdir(path.join(imagesRoot,id,'thumbs'),{recursive:true});
          await fs.copyFile(source,target);
          await fs.copyFile(thumbSource,path.join(imagesRoot,id,'thumbs',name));
          src = '../shared/img/projects/'+id+'/'+name;
          thumb = '../shared/img/projects/'+id+'/thumbs/'+name;
          copied += 1;
        }
        images.push({src,thumb,name:image.name,source:image.source});
      }
      prepared.push({...project,images});
    }

    await writeFile(path.join(jsDir,'projects.js'),exportProjectsJs(prepared),files);
    return {target:'local',projectDir:root,files,images:copied};
  }

  async function publish() {
    const state = await status();
    if (state.target === 'github') return publishGitHub();
    if (state.target === 'local' && state.configured) return publishLocal();
    if (state.target === 'local')
      throw fail('A weboldal projekt nem található: '+root,500);
    throw fail('A publikálás nincs beállítva. Hiányzó változó: ' +
      state.missing.join(', ') + '.', 503);
  }

  return {publish,status};
}

module.exports = {webPublisher,relativeImage};
