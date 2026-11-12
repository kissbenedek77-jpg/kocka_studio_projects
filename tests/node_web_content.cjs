'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseTxt,pageFromPairs,projectFromLegacy,buildSeed,normalizeContent,
  exportPageTxt,exportProjectsJs,absolute,PUBLIC_BASE} = require('../server/web_content.cjs');

test('A kulcs=érték szöveg beolvasása megjegyzéseket kihagy', () => {
  const pairs = parseTxt('# fejléc\nhero=RÓLUNK\n\nintro=Egy hosszú bevezető.\n');
  assert.deepEqual(pairs,[['hero','RÓLUNK'],['intro','Egy hosszú bevezető.']]);
});

test('Az oldal mezői csoportokba rendeződnek, magyar címkékkel', () => {
  const page = pageFromPairs('rolunk','Rólunk','rolunk',[
    ['hero','RÓLUNK'],['intro','Bemutatkozás.'],
    ['value_1','BIZALOM'],['value_2','KREATÍV'],
    ['service_1','ÉPÍTÉSZETI TERVEZÉS'],
    ['testimonial','Idézet']
  ]);
  assert.equal(page.id,'rolunk');
  const titles = page.groups.map(group => group.title);
  assert.deepEqual(titles,['Fejléc és bevezető','Értékek','Szolgáltatások','Idézet']);
  const hero = page.groups[0].fields[0];
  assert.equal(hero.key,'hero');
  assert.equal(hero.label,'Hero cím');
  assert.equal(hero.value,'RÓLUNK');
  assert.equal(page.groups[1].fields[1].label,'Érték 2');
  assert.equal(page.groups[2].fields[0].label,'Szolgáltatás 1');
  assert.equal(page.groups[1].fields[0].multiline,false);
});

test('A régi projektadatból abszolút kép-URL-ek lesznek', () => {
  const project = projectFromLegacy({
    id:'2010-teszt',year:2010,title:'Teszt ház',type:'Lakóépület',
    location:'Kaposvár',category:'lako',description:'Leírás',credits:'Kocka Stúdió',
    images:['../shared/img/projects/2010-teszt/01.jpg'],
    thumbs:['../shared/img/projects/2010-teszt/thumbs/01.jpg']
  });
  assert.equal(project.id,'2010-teszt');
  assert.equal(project.images.length,1);
  assert.equal(project.images[0].src,PUBLIC_BASE+'/shared/img/projects/2010-teszt/01.jpg');
  assert.equal(project.images[0].thumb,
    PUBLIC_BASE+'/shared/img/projects/2010-teszt/thumbs/01.jpg');
  assert.equal(project.images[0].source,'legacy');
  assert.equal(absolute('https://pelda.hu/kep.jpg'),'https://pelda.hu/kep.jpg');
});

test('A tartalom normalizálása megvédi a szerkezetet', () => {
  const content = normalizeContent({
    pages:[{id:'rolunk',title:'Rólunk',file:'rolunk',groups:[{title:'Fejléc',
      fields:[{key:'hero',label:'Hero',value:'  RÓLUNK  '}]}]}],
    projects:[{id:'a/b',title:'Ház',year:'2010',images:[{src:'/media/web/a/1.jpg'}]}]
  });
  assert.equal(content.pages[0].groups[0].fields[0].value,'RÓLUNK');
  assert.equal(content.projects[0].id,'a-b','az azonosító biztonságos karakterekre szűkül');
  assert.equal(content.projects[0].year,'2010');
  assert.equal(content.projects[0].images[0].thumb,'/media/web/a/1.jpg');
  assert.throws(()=>normalizeContent({pages:[],projects:[]}),/üres/);
});

test('Az export visszaadja a TXT-t és a projects.js-t', () => {
  const page = pageFromPairs('rolunk','Rólunk','rolunk',[['hero','RÓLUNK'],['intro','Bevezető']]);
  const txt = exportPageTxt(page);
  assert.match(txt,/hero=RÓLUNK/);
  assert.match(txt,/intro=Bevezető/);
  const projects = exportProjectsJs([{
    id:'haz',year:'2010',title:'Ház',type:'Lakóépület',location:'Kaposvár',
    category:'lako',description:'Leírás',credits:'Kocka',early:false,
    images:[{src:'/media/web/haz/1.jpg',thumb:'/media/web/haz/thumbs/1.jpg'}]
  }]);
  assert.match(projects,/const PROJECTS = \[/);
  assert.match(projects,/"cover": "\/media\/web\/haz\/1\.jpg"/);
  assert.match(projects,/"images": \[/);
});

test('A seed a projektlistát és az oldalakat is tartalmazza', () => {
  const seed = buildSeed({
    pages:[pageFromPairs('rolunk','Rólunk','rolunk',[['hero','RÓLUNK']])],
    projects:[{id:'p1',title:'Ház',images:[]}]
  });
  assert.equal(seed.version,1);
  assert.equal(seed.pages[0].title,'Rólunk');
  assert.equal(seed.projects[0].id,'p1');
  assert.ok(seed.updatedAt);
});
