'use strict';

// A weboldal-kezelő tárolója. A tartalom és a feltöltött képek a Railway
// szolgáltatás fájlrendszerén élnek (SITE_DATA_DIR, alapértéke
// data/website). A tartalom egyetlen JSON, a képek projektmappákba kerülnek,
// minden feltöltéshez 1800 px-es nagy változat és 520 px-es thumbnail készül.
//
// A mappa tartós, ha a Railway szolgáltatáshoz Volume van kötve; enélkül a
// következő deploy újra a seed tartalomból indul.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {normalizeContent,mergePages,clean} = require('./web_content.cjs');

const IMAGE_MIME = new Set(['image/jpeg','image/png','image/webp']);
const MAX_UPLOAD = 8 * 1024 * 1024;
const LARGE_WIDTH = 1800;
const THUMB_WIDTH = 520;

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const safeId = value => String(value || '').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,90);

function webStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.SITE_DATA_DIR ||
    path.join(__dirname,'..','data','website'));
  const seedFile = path.join(__dirname,'..','data','website','seed.json');
  const contentFile = path.join(dataDir,'content.json');
  const mediaDir = path.join(dataDir,'media');
  const app = {dataDir,contentFile,mediaDir};

  async function ensure() {
    await fsp.mkdir(mediaDir,{recursive:true});
    try {
      await fsp.access(contentFile);
    } catch (_) {
      let content = {version:1,updatedAt:new Date().toISOString(),pages:[],projects:[]};
      try {
        content = JSON.parse(await fsp.readFile(seedFile,'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fsp.writeFile(contentFile,JSON.stringify(normalizeContent(content),null,2),'utf8');
    }
    return app;
  }

  async function load() {
    await ensure();
    const raw = await fsp.readFile(contentFile,'utf8');
    return normalizeContent(JSON.parse(raw));
  }

  async function save(content) {
    const normalized = normalizeContent(content);
    normalized.updatedAt = new Date().toISOString();
    const temp = contentFile+'.tmp';
    await fsp.writeFile(temp,JSON.stringify(normalized,null,2),'utf8');
    await fsp.rename(temp,contentFile);
    return normalized;
  }

  function findPage(content,pageId) {
    const page = content.pages.find(item => item.id === pageId);
    if (!page) throw fail('Az oldal nem található: '+pageId,404);
    return page;
  }

  function findProject(content,projectId) {
    const project = content.projects.find(item => item.id === projectId);
    if (!project) throw fail('A projekt nem található: '+projectId,404);
    return project;
  }

  async function saveField(pageId,key,value) {
    const content = await load();
    const page = findPage(content,pageId);
    let found = false;
    for (const group of page.groups)
      for (const field of group.fields)
        if (field.key === key) { field.value = clean(value); found = true; }
    if (!found) throw fail('A mező nem található: '+key,404);
    return save(content);
  }

  // Az oldalak szerkezetének (oldalak, mezők, sorrend) összevonása a data
  // fájlokból olvasott állapottal. A szerkesztett értékek megmaradnak, az új
  // kulcsok és oldalak automatikusan bekerülnek, a töröltek kikerülnek.
  async function syncPages(pages) {
    if (!Array.isArray(pages) || !pages.length) return null;
    const content = await load();
    const before = JSON.stringify(content.pages);
    content.pages = mergePages(content.pages,pages);
    if (JSON.stringify(content.pages) === before) return null;
    return save(content);
  }

  async function saveProject(projectId,patch) {
    const content = await load();
    const project = findProject(content,projectId);
    const allowed = ['title','type','location','year','tagline','description','credits','category'];
    for (const key of allowed)
      if (Object.prototype.hasOwnProperty.call(patch || {},key))
        project[key] = clean(patch[key],key === 'description' ? 12000 : 600);
    return save(content);
  }

  async function addProject(project) {
    const content = await load();
    const base = safeId(project?.id || 'uj-projekt') || 'uj-projekt';
    let id = base, index = 2;
    while (content.projects.some(item => item.id === id)) id = `${base}-${index++}`;
    content.projects.push({
      id,title:clean(project?.title || 'Új projekt',200),type:'',location:'',year:'',
      tagline:'',description:'',credits:'',category:'',early:false,images:[]
    });
    return save(content);
  }

  async function deleteProject(projectId) {
    const content = await load();
    const index = content.projects.findIndex(item => item.id === projectId);
    if (index < 0) throw fail('A projekt nem található: '+projectId,404);
    const [removed] = content.projects.splice(index,1);
    await removeProjectMedia(projectId);
    return save(content);
  }

  async function reorderProjects(ids) {
    if (!Array.isArray(ids)) throw fail('A projekt sorrendje hiányzik.');
    const content = await load();
    const byId = new Map(content.projects.map(project => [project.id,project]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    for (const project of content.projects)
      if (!ordered.includes(project)) ordered.push(project);
    content.projects = ordered;
    return save(content);
  }

  async function removeProjectMedia(projectId) {
    const dir = path.join(mediaDir,safeId(projectId));
    await fsp.rm(dir,{recursive:true,force:true});
  }

  async function saveImage(projectId,{buffer,mime,name}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('A kép üres.');
    if (buffer.length > MAX_UPLOAD) throw fail('A kép legfeljebb 8 MB lehet.',413);
    let format = null;
    try { format = (await sharp(buffer,{failOn:'none'}).metadata()).format; }
    catch (_) { format = null; }
    const allowed = IMAGE_MIME.has(mime) || ['jpeg','png','webp'].includes(format);
    if (!allowed) throw fail('Csak JPG, PNG vagy WebP kép tölthető fel.');

    const id = safeId(projectId);
    const dir = path.join(mediaDir,id);
    const thumbs = path.join(dir,'thumbs');
    await fsp.mkdir(thumbs,{recursive:true});

    const base = Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
    const file = base+'.jpg';
    const image = sharp(buffer,{failOn:'none'}).rotate();
    const large = await image.clone().resize({width:LARGE_WIDTH,withoutEnlargement:true})
      .jpeg({quality:82,mozjpeg:true}).toBuffer();
    const thumb = await image.clone().resize({width:THUMB_WIDTH,withoutEnlargement:true})
      .jpeg({quality:75,mozjpeg:true}).toBuffer();
    await fsp.writeFile(path.join(dir,file),large);
    await fsp.writeFile(path.join(thumbs,file),thumb);

    const content = await load();
    const project = findProject(content,projectId);
    project.images.push({
      src:'/media/web/'+id+'/'+file,
      thumb:'/media/web/'+id+'/thumbs/'+file,
      name:clean(name || file,160) || file,
      source:'upload'
    });
    await save(content);
    return {content:await load(),image:project.images[project.images.length-1]};
  }

  async function deleteImage(projectId,src) {
    const content = await load();
    const project = findProject(content,projectId);
    const index = project.images.findIndex(image => image.src === src);
    if (index < 0) throw fail('A kép nem található a projektben.',404);
    const [removed] = project.images.splice(index,1);
    if (removed.source === 'upload') {
      const relative = String(removed.src).replace(/^\/media\/web\//,'');
      const file = path.join(mediaDir,relative);
      const safeRoot = path.join(mediaDir,safeId(projectId));
      if (file.startsWith(safeRoot)) {
        await fsp.rm(file,{force:true});
        await fsp.rm(path.join(safeRoot,'thumbs',path.basename(file)),{force:true});
      }
    }
    await save(content);
    return load();
  }

  async function reorderImages(projectId,srcs) {
    if (!Array.isArray(srcs)) throw fail('A képsorrend hiányzik.');
    const content = await load();
    const project = findProject(content,projectId);
    const bySrc = new Map(project.images.map(image => [image.src,image]));
    const ordered = srcs.map(src => bySrc.get(src)).filter(Boolean);
    for (const image of project.images) if (!ordered.includes(image)) ordered.push(image);
    project.images = ordered;
    return save(content);
  }

  function mediaFile(relative) {
    const cleanPath = String(relative || '').replace(/^\/+/,'');
    const file = path.resolve(mediaDir,cleanPath);
    if (!file.startsWith(mediaDir+path.sep)) throw fail('Érvénytelen képútvonal.',400);
    return file;
  }

  return {ensure,load,save,saveField,syncPages,saveProject,addProject,deleteProject,reorderProjects,
    saveImage,deleteImage,reorderImages,mediaFile,dataDir,mediaDir};
}

module.exports = {webStore,MAX_UPLOAD};
