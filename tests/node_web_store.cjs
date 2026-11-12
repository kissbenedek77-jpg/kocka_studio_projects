'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {webStore} = require('../server/web_store.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'kocka-web-'));
  return {dir,store:webStore({dataDir:dir})};
}

async function smallImage() {
  return sharp({create:{width:800,height:600,channels:3,background:'#c5cf00'}})
    .jpeg().toBuffer();
}

test('Az első induláskor a seed tartalom másolódik be', async () => {
  const {dir,store} = tempStore();
  const content = await store.load();
  assert.ok(fs.existsSync(path.join(dir,'content.json')));
  assert.ok(content.pages.length >= 2,'az oldalak bekerülnek');
  assert.ok(content.projects.length >= 50,'a projektek bekerülnek');
  assert.ok(content.projects.some(project => project.images.length > 0),
    'a projektképek hivatkozásai megmaradnak');
});

test('A mező és a projekt mentése a tárolóba ír', async () => {
  const {store} = tempStore();
  const content = await store.load();
  const page = content.pages.find(item => item.id === 'rolunk');
  const field = page.groups[0].fields[0];
  const saved = await store.saveField('rolunk',field.key,'Új szöveg.');
  const updated = saved.pages.find(item => item.id === 'rolunk')
    .groups[0].fields.find(item => item.key === field.key);
  assert.equal(updated.value,'Új szöveg.');

  const project = saved.projects[0];
  const after = await store.saveProject(project.id,{title:'Átírt cím',year:'2020'});
  assert.equal(after.projects[0].title,'Átírt cím');
  assert.equal(after.projects[0].year,'2020');
});

test('Projekt hozzáadása, sorrendezése és törlése', async () => {
  const {store} = tempStore();
  const start = await store.load();
  const created = await store.addProject({title:'Új ház'});
  assert.equal(created.projects.length,start.projects.length+1);
  const added = created.projects[created.projects.length-1];
  assert.equal(added.title,'Új ház');

  const ids = created.projects.map(project => project.id).reverse();
  const reordered = await store.reorderProjects(ids);
  assert.equal(reordered.projects[0].id,ids[0]);

  const deleted = await store.deleteProject(added.id);
  assert.ok(!deleted.projects.some(project => project.id === added.id));
});

test('A képfeltöltés nagy változatot és thumbnailed készít', async () => {
  const {dir,store} = tempStore();
  const content = await store.load();
  const project = content.projects[0];
  const result = await store.saveImage(project.id,{
    buffer:await smallImage(),mime:'image/jpeg',name:'foto.jpg'
  });
  const image = result.image;
  assert.match(image.src,/^\/media\/web\//);
  assert.match(image.thumb,/\/thumbs\//);
  assert.equal(image.source,'upload');

  const large = image.src.replace('/media/web/','');
  const thumb = image.thumb.replace('/media/web/','');
  assert.ok(fs.existsSync(path.join(dir,'media',large)),'a nagy kép elmentve');
  assert.ok(fs.existsSync(path.join(dir,'media',thumb)),'a thumbnail elmentve');
  const meta = await sharp(fs.readFileSync(path.join(dir,'media',thumb))).metadata();
  assert.ok(meta.width <= 520);

  const projectAfter = result.content.projects.find(item => item.id === project.id);
  assert.ok(projectAfter.images.some(item => item.src === image.src),
    'a kép bekerül a projekt galériájába');

  const reordered = await store.reorderImages(project.id,
    projectAfter.images.slice().reverse().map(item => item.src));
  const afterReorder = reordered.projects.find(item => item.id === project.id);
  assert.equal(afterReorder.images[0].src,projectAfter.images[projectAfter.images.length-1].src);

  const deleted = await store.deleteImage(project.id,image.src);
  assert.ok(!deleted.projects.find(item => item.id === project.id).images
    .some(item => item.src === image.src));
  assert.ok(!fs.existsSync(path.join(dir,'media',large)),'a feltöltött fájl is törlődik');
});

test('A feltöltés elutasítja a nem képet és a túl nagy fájlt', async () => {
  const {store} = tempStore();
  const content = await store.load();
  const project = content.projects[0];
  await assert.rejects(store.saveImage(project.id,{
    buffer:Buffer.from('nem kép'),mime:'text/plain',name:'a.txt'
  }),/Csak JPG/);
  await assert.rejects(store.saveImage(project.id,{
    buffer:Buffer.alloc(9*1024*1024),mime:'image/jpeg',name:'nagy.jpg'
  }),/legfeljebb 8 MB/);
});

test('A média útvonal nem léphet ki a mappából', () => {
  const {store} = tempStore();
  assert.throws(()=>store.mediaFile('../../titok.txt'),/Érvénytelen/);
  assert.match(store.mediaFile('projekt/1.jpg'),/projekt[\\/]1\.jpg$/);
});
