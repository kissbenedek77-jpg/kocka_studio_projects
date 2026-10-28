'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {technicalReplacements,technicalReview,validateTechnicalField,fieldSheetRows} = require('../server/technical_document.cjs');
const {mergeRequests,unresolvedMarkers} = require('../server/doc_merge.cjs');
const {technicalSupplementRequests} = require('../server/technical_upgrade.cjs');

test('Műszaki sablon csak ismert projektadatot ír be, az ellenőrizetlen mezőt láthatóan hagyja', () => {
  const sheetRows = Array.from({length:20},() => Array(13).fill(''));
  sheetRows[1][1] = 'Lke-8'; sheetRows[1][4] = '1000'; sheetRows[1][9] = '220,99';
  sheetRows[1][12] = '21,9%'; sheetRows[8][1] = '2'; sheetRows[8][5] = '1';
  const programRows = Array.from({length:16},(_,i) => {
    const letter = String.fromCharCode(97+i);
    return [letter,`${letter}) Projektadat: {{TERVEZESI_ADATOK:Munkalap1!B2}}.`];
  });
  const fields = fieldSheetRows();
  fields.find(row => row[0] === 'TERV_TARGYA')[1] = 'Lakóépület bővítése';
  const values = technicalReplacements({project:{uid:'ABC123',projektCim:'Próba'},
    sheetRows,programRows,fieldRows:fields.slice(1),
    pdfFiles:[{name:'EK-01 Helyszínrajz.pdf'}]});
  assert.equal(values.TERV_TARGYA,'Lakóépület bővítése');
  assert.equal(values['TERVEZESI_ADATOK:tervezett_foldszinti_beepites_szazalek'],'21,9');
  assert.equal(values['TERVEZESI_PROGRAM:a'],'Projektadat: Lke-8.');
  assert.match(values.TERVJEGYZEK,/Helyszínrajz.*M=1:200/);
  assert.match(values.PARKOLOEGYENLEG_ERTEKELES,/különbség: -1 db/);
  assert.equal(values['OVEZET:forras_url'],undefined);
  const doc = {body:{content:[{paragraph:{elements:[
    {startIndex:1,textRun:{content:'{{TERV_TARGYA}} és {{OVEZET:forras_url}}\n'}}]}}]},namedRanges:{}};
  const requests = mergeRequests(doc,values,{allowUnknown:true});
  assert.equal(requests.filter(item => item.createNamedRange).length,1);
  assert.equal(requests.find(item => item.replaceNamedRangeContent)?.replaceNamedRangeContent.text,
    'Lakóépület bővítése');
  assert.deepEqual(unresolvedMarkers(doc),['TERV_TARGYA','OVEZET:forras_url']);
});

test('Ellenőrizendő helyiségösszeg és tervlap méretarány nem véglegesíthető', () => {
  const doc={body:{content:[{paragraph:{elements:[{textRun:{
    content:'[ELLENŐRIZENDŐ: forrásösszeg] és [méretarány ellenőrizendő]\n'}}]}}]}};
  assert.deepEqual(unresolvedMarkers(doc),['ellenőrizendő szöveg']);
});

test('Az AI hiányjelölése a véglegesítést blokkolja', () => {
  const doc={body:{content:[{paragraph:{elements:[{textRun:{
    content:'Kész szöveg. [KIEGÉSZÍTENDŐ: alapozás rétegrendje]\n'}}]}}]}};
  assert.deepEqual(unresolvedMarkers(doc),['kiegészítendő: alapozás rétegrendje']);
});

test('Övezeti jóváhagyás csak ellenőrzött állapot és visszakereshető forrás mellett kerül be', () => {
  const fields = fieldSheetRows().slice(1);
  const set = (key,value) => {fields.find(row => row[0] === key)[1] = value;};
  set('OVEZET:ellenorzes_allapota','Nem ellenőrzött');
  set('OVEZET:forras_url','https://example.org/hesz');
  set('OVEZET:ellenorzes_datuma','2026-09-30');
  const programRows = Array.from({length:16},(_,i) => {
    const letter = String.fromCharCode(97+i);
    return [letter,`${letter}) Jóváhagyott tervezési adat.`];
  });
  const input = {project:{uid:'ABC123'},sheetRows:[],programRows,fieldRows:fields};
  assert.equal(technicalReplacements(input)['OVEZET:ellenorzes_allapota'],undefined);
  set('OVEZET:ellenorzes_allapota','Ellenőrizve');
  assert.equal(technicalReplacements(input)['OVEZET:ellenorzes_allapota'],'Ellenőrizve');
  set('OVEZET:forras_url','nincs forrás');
  assert.equal(technicalReplacements(input)['OVEZET:ellenorzes_allapota'],undefined);
});

test('Az övezeti mérleg ellenőrzi a számokat és csak jóváhagyott forrásból készül', () => {
  const key = cell => `TERVEZESI_ADATOK:Munkalap1!${cell}`;
  const sheet = Object.fromEntries(Object.entries({E2:'1000',J2:'250',M2:'25%',
    J5:'600',M5:'60%',B3:'30%',B6:'6,0',F6:'5,5',B5:'50%'}).map(([cell,value])=>[key(cell),value]));
  assert.equal(technicalReview(sheet,{}).comparison,'');
  const approved=technicalReview(sheet,{'OVEZET:ellenorzes_allapota':'Ellenőrizve'});
  assert.equal(approved.issues.length,0);
  assert.match(approved.comparison,/Földszinti beépítettség: előírt max\. 30 %; tervezett 25 %; megfelel/);
  sheet[key('M2')]='35%';
  const invalid=technicalReview(sheet,{'OVEZET:ellenorzes_allapota':'Ellenőrizve'});
  assert.match(invalid.issues.join(' '),/beépítési százalék eltér/);
  assert.match(invalid.comparison,/nem felel meg/);
  sheet[key('M2')]='25%';sheet[key('J5')]='1200';
  assert.match(technicalReview(sheet,{}).issues.join(' '),/nagyobb a telekterületnél/);
});

test('A szintterületi mutató csak akkor kerül a mérlegbe, ha van rá előírás', () => {
  const key = cell => `TERVEZESI_ADATOK:Munkalap1!${cell}`;
  const sheet = Object.fromEntries(Object.entries({E2:'1000',J2:'250',M2:'25%',J5:'600',
    M5:'60%',B3:'30%',B6:'6,0',F6:'5,5',B5:'50%',M7:'1,2'}).map(([cell,value])=>[key(cell),value]));
  assert.doesNotMatch(technicalReview(sheet,{'OVEZET:ellenorzes_allapota':'Ellenőrizve'}).comparison,
    /Szintterületi mutató/);
  sheet[key('B7')]='0,8';
  const reviewed=technicalReview(sheet,{'OVEZET:ellenorzes_allapota':'Ellenőrizve'});
  assert.match(reviewed.comparison,/Szintterületi mutató: előírt max\. 0,8 m²\/m²; tervezett 1,2 m²\/m²; nem felel meg/);
  assert.match(reviewed.issues.join(' '),/Szintterületi mutató/);
});

test('A sablon cellahivatkozásai üres adatnál sem hagynak nyers jelölőt', () => {
  const sheetRows = Array.from({length:20},() => Array(13).fill(''));
  const programRows = Array.from({length:16},(_,index) => {
    const letter = String.fromCharCode(97+index);
    return [letter,`${letter}) Kitöltött program.`];
  });
  const values = technicalReplacements({project:{uid:'ABC123'},sheetRows,programRows,fieldRows:[]});
  for (const address of ['E2','F2','B3','M2','L2','E6','F6','E8','F8','B9','E9','F9','B7','M7','M5','J7'])
    assert.equal(values['TERVEZESI_ADATOK:Munkalap1!'+address],'',address);
  for (const key of ['TERVEZESI_ADATOK:megengedett_lakasszam_db',
    'TERVEZESI_ADATOK:tervezett_foldszinti_beepites_szazalek',
    'TERVEZESI_ADATOK:tervezett_foldszinti_beepites_m2',
    'PARKOLOEGYENLEG_ERTEKELES','BEEPITESI_MERLEG','TERVJEGYZEK'])
    assert.equal(values[key],'',key);
  assert.equal(values.IRATJEGYZEK,'Építészeti műszaki leírás (jelen dokumentum)');
  const doc = {body:{content:[{paragraph:{elements:[{startIndex:1,textRun:{
    content:'{{TERVEZESI_ADATOK:Munkalap1!F8}} {{PARKOLOEGYENLEG_ERTEKELES}}\n'}}]}}]},
  namedRanges:{}};
  const requests = mergeRequests(doc,values,{allowUnknown:true});
  assert.equal(requests.filter(item=>item.createNamedRange).length,2);
  assert.ok(requests.filter(item=>item.replaceNamedRangeContent)
    .every(item=>item.replaceNamedRangeContent.text==='\u200B'));
});

test('A tervfázis és kiadási dátum hibás értékeit mentés előtt elutasítja', () => {
  assert.doesNotThrow(()=>validateTechnicalField('DOKUMENTUM:kiadas_datuma','2026-10-07'));
  assert.throws(()=>validateTechnicalField('DOKUMENTUM:kiadas_datuma','2026-02-30'),/dátum/);
  assert.throws(()=>validateTechnicalField('OVEZET:ellenorzes_datuma','2026-02-30'),/dátum/);
  assert.throws(()=>validateTechnicalField('DOKUMENTUM:tervfazis','Vázlat'),/tervfázist/);
});

test('A régi DRAFT bővítése megőrzi az eredeti tartalmat és ismételhető', () => {
  const lines=['Tartalomjegyzék','Adatok','Beépítési paraméterek','Épület adatai',
    'Tűzvédelem','Meglévő, kézzel jóváhagyott szöveg'];
  const doc={body:{content:lines.map((line,index)=>({startIndex:1+index*50,
    paragraph:{elements:[{textRun:{content:line+'\n'}}]}}))}};
  const additions=technicalSupplementRequests(doc);
  assert.equal(additions.length,5);
  assert.ok(additions.every(item=>item.insertText.location.index>0));
  assert.deepEqual(lines[5],'Meglévő, kézzel jóváhagyott szöveg');
  const upgraded={body:{content:[...doc.body.content,{startIndex:500,paragraph:{elements:[{
    textRun:{content:additions.map(item=>item.insertText.text).join('\n')}}]}}]}};
  assert.deepEqual(technicalSupplementRequests(upgraded),[]);
});
