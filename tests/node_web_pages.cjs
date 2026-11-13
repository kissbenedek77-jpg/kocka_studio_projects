'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pageFromPairs,exportPageTxt,exportProjectsTxt,
  pagesFromFiles,mergePages,pageTitleFrom,hasBlocks} = require('../server/web_content.cjs');

test('Az oldal címe a # oldal: sorból, különben a fájlnévből jön', () => {
  assert.equal(pageTitleFrom('# oldal: Rólunk\nhero=A','rolunk'),'Rólunk');
  assert.equal(pageTitleFrom('# page: Kapcsolat\nhero=A','kapcsolat'),'Kapcsolat');
  assert.equal(pageTitleFrom('# Kocka Stúdió – szövegek\n\nhero=A','arak'),'Árak');
  assert.equal(pageTitleFrom('hero=A','fooldal'),'Főoldal');
  assert.equal(pageTitleFrom('hero=A','szolgaltatasok'),'Szolgáltatások');
});

test('A blokkos fájl nem oldal, hanem rekordlista', () => {
  assert.equal(hasBlocks('[projekt-1]\ntitle=Ház\n'),true);
  assert.equal(hasBlocks('hero=A\nintro=B\n'),false);
});

test('A data fájlokból oldalak lesznek, a fájl kulcsaival', () => {
  const pages = pagesFromFiles([
    {file:'rolunk.txt',text:'# oldal: Rólunk\nhero=RÓLUNK\nintro=Bevezető\n'},
    {file:'projektek.txt',text:'[haz]\ntitle=Ház\n'}
  ]);
  assert.equal(pages.length,1,'a blokkos projektek.txt kimarad');
  assert.equal(pages[0].id,'rolunk');
  assert.equal(pages[0].file,'rolunk');
  assert.equal(pages[0].title,'Rólunk');
  const keys = pages[0].groups.flatMap(group => group.fields.map(field => field.key));
  assert.deepEqual(keys,['hero','intro']);
  assert.equal(pages[0].groups[0].fields[0].value,'RÓLUNK');
});

test('Az összevonás a fájl szerkezetét követi, az értékeket megtartja', () => {
  const current = [pageFromPairs('rolunk','Rólunk','rolunk',[
    ['hero','Szerkesztett'],['torolt','Régi mező']
  ])];
  const scanned = pagesFromFiles([{file:'rolunk.txt',
    text:'# oldal: Rólunk új\nhero=Fájl érték\nuj_kulcs=Új érték\n'}]);
  const merged = mergePages(current,scanned);
  assert.equal(merged.length,1);
  assert.equal(merged[0].title,'Rólunk új','a fájlban megadott cím nyer');
  const fields = merged[0].groups.flatMap(group => group.fields);
  assert.deepEqual(fields.map(field => field.key),['hero','uj_kulcs']);
  assert.equal(fields[0].value,'Szerkesztett','a meglévő érték megmarad');
  assert.equal(fields[1].value,'Új érték','az új kulcs a fájlból jön');
});

test('Átnevezett fájl esetén a cím alapján megmaradnak az értékek', () => {
  const current = [pageFromPairs('home','Főoldal','index',[
    ['hero','Szerkesztett hero'],['cta','Szerkesztett CTA']
  ])];
  const scanned = pagesFromFiles([{file:'fooldal.txt',
    text:'# oldal: Főoldal\nhero=Fájl hero\ncta=Fájl CTA\nuj=Új\n'}]);
  const merged = mergePages(current,scanned);
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,'fooldal','a fájl neve lesz az azonosító');
  assert.equal(merged[0].file,'fooldal');
  const values = new Map(merged[0].groups.flatMap(group => group.fields)
    .map(field => [field.key,field.value]));
  assert.equal(values.get('hero'),'Szerkesztett hero','a régi érték megmarad');
  assert.equal(values.get('uj'),'Új','az új kulcs a fájlból jön');
});

test('A projektek szövegei blokkos TXT-be íródnak', () => {
  const txt = exportProjectsTxt([{id:'haz',title:'Ház',year:'2010',
    description:'Leírás',credits:'Kocka',category:'lako'}]);
  assert.match(txt,/\[haz\]/);
  assert.match(txt,/^title=Ház$/m);
  assert.match(txt,/^year=2010$/m);
  assert.doesNotMatch(txt,/category/,'a kategória nem része a szöveg-blokknak');
});

test('Az oldal exportja a címet is megjegyzésként írja', () => {
  const txt = exportPageTxt(pageFromPairs('rolunk','Rólunk','rolunk',[['hero','RÓLUNK']]));
  assert.match(txt,/^# oldal: Rólunk$/m);
});
