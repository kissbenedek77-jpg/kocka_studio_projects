'use strict';

// A weboldal-kezelő „publikálása”: a szerkesztett tartalmat visszaírja a
// nyilvános weboldal projektjébe (shared/data/*.txt, shared/js/projects.js),
// a feltöltött képeket pedig a shared/img/projects/<projekt>/ mappába másolja.
//
// A célmappa a WEB_PROJECT_DIR környezeti változóban adható meg. Ha nincs
// beállítva, a repó testvérmappáját használjuk (fejlesztői használat).
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

function webPublisher({store,projectDir}) {
  const root = projectDir ? path.resolve(projectDir) : '';

  async function status() {
    if (!root) return {configured:false,path:'',reason:'nincs beállítva'};
    try {
      await fs.access(path.join(root,'shared','data'));
      return {configured:true,path:root};
    } catch (_) {
      return {configured:false,path:root,reason:'a mappa nem érhető el'};
    }
  }

  async function writeFile(file,text,files) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp = file+'.tmp';
    await fs.writeFile(temp,text,'utf8');
    await fs.rename(temp,file);
    files.push(path.relative(root,file));
  }

  async function publish() {
    if (!root) throw fail('A weboldal projekt mappa nincs beállítva (WEB_PROJECT_DIR).',500);
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
    return {projectDir:root,files,images:copied};
  }

  return {publish,status};
}

module.exports = {webPublisher,relativeImage};
