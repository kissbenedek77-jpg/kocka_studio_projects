'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {retegekFromText,retegekFromRows,retegrendFacts,retegrendValues,classify} =
  require('../server/retegrend.cjs');

test('A munkalap sorai blokkonként, a fejléc után rétegekké alakulnak', () => {
  const rows = [
    ['F Határoló fal'],
    ['3 rtg','diszperziós festés'],
    ['1,5 cm','vakolat'],
    ['30 cm','Porotherm N+F kerámia falazat'],
    ['16 cm','Austrotherm Grafit EPS hőszigetelés'],
    [],
    ['T Magastető kerámia fedéssel'],
    ['kerámia fedés'],
    ['3 cm','lécezés'],
    ['15 cm','szaruzat láng- és gombamentesítve']
  ];
  const blocks = retegekFromRows(rows);
  assert.equal(blocks.length,2);
  assert.equal(blocks[0].title,'F Határoló fal');
  assert.equal(blocks[0].layers.length,4);
  assert.equal(blocks[0].layers[0].thickness,'3 rtg');
});

test('A „Födém” nem határoló fal, a „Magastető” nem födém', () => {
  assert.equal(classify({title:'F Födém',layers:[]}),'slab');
  assert.equal(classify({title:'M Födém vasbeton',layers:[]}),'slab');
  assert.equal(classify({title:'T Magastető',layers:[]}),'roof');
  assert.equal(classify({title:'F Határoló fal',layers:[]}),'wall');
  assert.equal(classify({title:'P Belső padló',layers:[]}),'floor');
});

test('A Metszetek szövegéből csak a rétegrend-blokk és a rétegsorok kerülnek be', () => {
  const text = [
    'ÉPÍTÉSZ MŰSZAKI LEÍRÁS M=1:50',
    'EK-04 Metszetek',
    'F1 Határoló fal',
    '3 rtg diszperziós festés',
    '1,5 cm vakolat',
    '30 cm Porotherm N+F kerámia falazat',
    '16 cm Austrotherm EPS hőszigetelés',
    'M1 Födém',
    '20 cm vasbeton födém',
    '4 cm aljzatbeton',
    'M=1:50 lépték, tervlap: EK-04',
    'T1 Fedélszék',
    '15 cm szaruzat láng- és gombamentesítve',
    'kerámia fedés'
  ].join('\n');
  const blocks = retegekFromText(text);
  assert.deepEqual(blocks.map(block => block.title),
    ['F1 Határoló fal','M1 Födém','T1 Fedélszék']);
  // A rajzi feliratok (lépték, tervlap) nem lesznek rétegek.
  assert.equal(blocks.some(block => block.layers.some(layer =>
    /M\s*=\s*1:|tervlap/i.test(layer.material))),false);
  // Blokkfejléc nélküli sor nem nyit új blokkot.
  const stray = retegekFromText('csak egy mondat a tervről\n30 cm valami falazat');
  assert.deepEqual(stray,[]);
});

test('A szerkezeti réteg a vastagság és az anyag, nem a hőszigetelés vagy a vakolat', () => {
  const sheetRows = [
    ['F Határoló fal'],
    ['3 rtg','diszperziós festés'],
    ['3 rtg','glettelés'],
    ['1,5 cm','vakolat'],
    ['30 cm','Porotherm N+F kerámia falazat'],
    ['16 cm','Austrotherm Grafit EPS hőszigetelés'],
    [],
    ['T Magastető kerámia fedéssel'],
    ['kerámia fedés eredetivel megegyező fedéssel'],
    ['3 cm','lécezés'],
    ['15 cm','szaruzat láng- és gombamentesítve, közötte kőzetgyapot'],
    [],
    ['P Belső padló'],
    ['2 cm','burkolat'],
    ['8 cm','vasalt aljzatbeton']
  ];
  const planTexts = [{name:'EK-04 Metszetek.pdf',text:[
    'M1 Födém',
    '20 cm vasbeton födém',
    '4 cm aljzatbeton',
    '1 rtg párazáró fólia'
  ].join('\n')}];
  const facts = retegrendFacts({sheetRows,planTexts});
  assert.equal(facts.wall.material,'Porotherm N+F kerámia falazat');
  assert.equal(facts.wall.thickness,'30 cm');
  assert.match(facts.wall.insulation,/EPS/);
  assert.equal(facts.roof.origin,'sheet');
  assert.match(facts.roof.material,/szaruzat/);
  assert.equal(facts.roof.thickness,'15 cm');
  assert.match(facts.roof.covering,/kerámia fedés/);
  assert.equal(facts.slab.origin,'pdf');
  assert.equal(facts.slab.material,'vasbeton födém');
  assert.equal(facts.slab.thickness,'20 cm');
  const values = retegrendValues(facts);
  assert.equal(values['retegrend:fal_anyag'],'Porotherm N+F kerámia falazat');
  assert.equal(values['retegrend:fal_vastagsag'],'30 cm');
  assert.equal(values['retegrend:fodem'],'20 cm vasbeton födém');
  assert.equal(values['retegrend:fedelszek'],'15 cm szaruzat láng- és gombamentesítve, közötte kőzetgyapot');
  assert.match(values['retegrend:teto'],/kerámia fedés/);
});

test('Hiányzó rétegrend helyén hiányjelölés marad, anyag nem készül kitalált adatból', () => {
  const facts = retegrendFacts({sheetRows:[],planTexts:[]});
  assert.equal(facts.wall,null);
  const values = retegrendValues(facts);
  for (const key of ['retegrend:fal_anyag','retegrend:fal_vastagsag','retegrend:fodem',
    'retegrend:fedelszek','retegrend:teto'])
    assert.match(values[key],/^\[KIEGÉSZÍTENDŐ: /,key);
});
