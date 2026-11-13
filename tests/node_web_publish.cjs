'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {webStore} = require('../server/web_store.cjs');
const {webPublisher,relativeImage} = require('../server/web_publish.cjs');
const {PUBLIC_BASE} = require('../server/web_content.cjs');

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'kocka-web-pub-data-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(),'kocka-web-pub-site-'));
  fs.mkdirSync(path.join(projectDir,'shared','data'),{recursive:true});
  fs.mkdirSync(path.join(projectDir,'shared','js'),{recursive:true});
  const store = webStore({dataDir});
  return {dataDir,projectDir,store};
}

test('A nyilvános kép-URL visszaalakul relatív útvonallá', () => {
  assert.equal(relativeImage(PUBLIC_BASE+'/shared/img/projects/a/1.jpg'),
    '../shared/img/projects/a/1.jpg');
  assert.equal(relativeImage('https://masik.hu/kep.jpg'),'https://masik.hu/kep.jpg');
  assert.equal(relativeImage(''),'');
});

test('A publikálás kiírja a TXT-ket és a projects.js-t', async () => {
  const {projectDir,store} = setup();
  const content = await store.load();
  const page = content.pages.find(item => item.id === 'rolunk');
  await store.saveField('rolunk',page.groups[0].fields[0].key,'Publikált hero');
  const publisher = webPublisher({store,projectDir});
  const status = await publisher.status();
  assert.equal(status.configured,true);
  const result = await publisher.publish();
  assert.ok(result.files.includes(path.join('shared','data','rolunk.txt')));
  assert.ok(result.files.includes(path.join('shared','js','projects.js')));
  const txt = fs.readFileSync(path.join(projectDir,'shared','data','rolunk.txt'),'utf8');
  assert.match(txt,/Publikált hero/);
  const js = fs.readFileSync(path.join(projectDir,'shared','js','projects.js'),'utf8');
  assert.match(js,/const PROJECTS = \[/);
  assert.match(js,/2002-falloskut-kapola|Római katolikus kápolna/);
});

test('A feltöltött kép a weboldal shared/img mappájába másolódik', async () => {
  const {projectDir,store} = setup();
  const content = await store.load();
  const project = content.projects[0];
  const buffer = await sharp({create:{width:600,height:400,channels:3,background:'#c5cf00'}})
    .jpeg().toBuffer();
  const upload = await store.saveImage(project.id,{buffer,mime:'image/jpeg',name:'uj.jpg'});
  const image = upload.image;
  const publisher = webPublisher({store,projectDir});
  const result = await publisher.publish();
  assert.equal(result.images,1);
  const fileName = path.basename(image.src);
  const expected = path.join(projectDir,'shared','img','projects',project.id,fileName);
  assert.ok(fs.existsSync(expected),'a kép átmásolva');
  assert.ok(fs.existsSync(path.join(projectDir,'shared','img','projects',project.id,
    'thumbs',fileName)),'a thumbnail is átmásolva');
  const js = fs.readFileSync(path.join(projectDir,'shared','js','projects.js'),'utf8');
  assert.match(js,new RegExp('../shared/img/projects/'+project.id+'/'+fileName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('Hiányzó célmappa esetén a publikálás érthető hibát ad', async () => {
  const {store} = setup();
  const publisher = webPublisher({store,projectDir:path.join(os.tmpdir(),'nincs-ilyen-'+Date.now())});
  const status = await publisher.status();
  assert.equal(status.configured,false);
  await assert.rejects(publisher.publish(),/nem található/);
  const empty = webPublisher({store,projectDir:''});
  await assert.rejects(empty.publish(),/SITE_GITHUB_REPO/);
});

test('GitHub módban a projektlista a repóba megy, a feltöltött kép abszolút URL-t kap', async () => {
  const {projectDir,store} = setup();
  const content = await store.load();
  const project = content.projects[0];
  const buffer = await sharp({create:{width:600,height:400,channels:3,background:'#c5cf00'}})
    .jpeg().toBuffer();
  await store.saveImage(project.id,{buffer,mime:'image/jpeg',name:'git.jpg'});
  const sent = [];
  const git = {
    status:()=>({configured:true,repo:'o/r',branch:'main',path:'',missing:[]}),
    publish:async(files,message)=>{sent.push({files,message});
      return {commit:'abc1234',files:files.map(file=>file.path)}}
  };
  const publisher = webPublisher({store,projectDir,git});
  const state = await publisher.status();
  assert.equal(state.target,'github');
  assert.equal(state.repo,'o/r');
  const result = await publisher.publish();
  assert.equal(result.target,'github');
  assert.equal(result.images,0,'a kép nem másolódik a repóba');
  assert.equal(result.commit,'abc1234');
  assert.equal(sent.length,1);
  assert.match(sent[0].message,/Weboldal tartalom/);
  const js = sent[0].files.find(file => file.path === 'shared/js/projects.js').text;
  const base = PUBLIC_BASE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(js,new RegExp(base+'/media/web/'),'a feltöltött kép a szerverről jön');
  assert.equal(fs.existsSync(path.join(projectDir,'shared','js','projects.js')),false,
    'helyi fájl nem íródik');
});
