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

test('A pincefal, a lábazat, a járda és a terasz nem a fő szerkezet', () => {
  assert.equal(classify({title:'F3 Pincefal',layers:[]}),'basement');
  assert.equal(classify({title:'L1 Lábazat',layers:[]}),'plinth');
  assert.equal(classify({title:'K1 Járda',layers:[]}),'paving');
  assert.equal(classify({title:'T2 Terasz',layers:[]}),'terrace');
});

test('Csak a „Rétegrendek:” blokk belsejéből lesznek rétegek', () => {
  const text = [
    'ÉPÍTÉSZ MŰSZAKI LEÍRÁS M=1:50',
    'EK-04 Metszetek',
    'F9 Rajzi felirat nem réteg',
    '30 cm valami falazat',
    'Rétegrendek:',
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
  // A blokk a rajzi megjegyzésnél véget ér, az utána következő T1 nem része.
  assert.deepEqual(blocks.map(block => block.title),['F1 Határoló fal','M1 Födém']);
  assert.equal(blocks.some(block => block.layers.some(layer =>
    /M\s*=\s*1:|tervlap/i.test(layer.material))),false);
  // Címsor nélküli szövegből nem lesz rétegrend.
  const stray = retegekFromText('csak egy mondat a tervről\n30 cm valami falazat');
  assert.deepEqual(stray,[]);
});

test('Az összefolyó anyagsor a layout-oszlopokból tagolódik', () => {
  const raw = [
    'Rétegrendek:',
    'F3 Pincefal 3 rtg 3 rtg 1,5 cm 30 cm 2 rtg',
    '15 cm 16 cm 2 cm',
    'diszperziós festés glettelés vakolat Porotherm 30 kerámia pincefalazó elem '+
      '4 mm SBS szigetelés hideg bitumenmáz kellősítés zsalukő szigetelés védő fal '+
      'XPS hőszigetelés geotextília lemez',
    'É'
  ].join('\n');
  const layout = [
    'Rétegrendek:',
    'F3 Pincefal    diszperziós festés',
    '3 rtg          glettelés',
    '3 rtg          vakolat',
    '1,5 cm         Porotherm 30 kerámia pincefalazó elem',
    '30 cm          4 mm SBS szigetelés',
    '2 rtg          hideg bitumenmáz kellősítés',
    '               zsalukő szigetelés védő fal',
    '15 cm          XPS hőszigetelés',
    '16 cm          geotextília lemez',
    '2 cm',
    'É'
  ].join('\n');
  const blocks = retegekFromText(raw,layout,'EK-05 Metszetek.pdf');
  assert.equal(blocks.length,1);
  assert.deepEqual(blocks[0].layers, [
    {thickness:'3 rtg',material:'diszperziós festés'},
    {thickness:'3 rtg',material:'glettelés'},
    {thickness:'1,5 cm',material:'vakolat'},
    {thickness:'30 cm',material:'Porotherm 30 kerámia pincefalazó elem'},
    {thickness:'2 rtg',material:'4 mm SBS szigetelés'},
    {thickness:'',material:'hideg bitumenmáz kellősítés'},
    {thickness:'15 cm',material:'zsalukő szigetelés védő fal'},
    {thickness:'16 cm',material:'XPS hőszigetelés'},
    {thickness:'2 cm',material:'geotextília lemez'}
  ]);
  assert.equal(blocks[0].source,'EK-05 Metszetek');
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
    'Rétegrendek:',
    'M1 Födém',
    '20 cm vasbeton födém',
    '4 cm aljzatbeton',
    '1 rtg párazáró fólia',
    'É'
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
  // A jóváhagyott szöveg blokkonként tagolt: címsor, majd tabulált rétegsorok.
  assert.match(facts.lines.join('\n'),/^F Határoló fal\n3 rtg\tdiszperziós festés/m);
  assert.match(facts.lines.join('\n'),/M1 Födém\n20 cm\tvasbeton födém/);
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

test('A Mennyezet blokk külön födém, nem olvad a Magastetőbe', () => {
  const text = [
    'RÉTEGRENDEK',
    'T1 Magastető',
    '30/50 kerámia cserép fedés lécezés ellenléc páraáteresztő fólia szaruzat',
    'M1 Mennyezet 25 cm 25 cm 1 cm 3 rtg 3 rtg',
    'kőzetgyapot hőszigetelés fektetve Leier mesterfödém tartószerkezeti terv szerint Vakolat glettelés diszperziós festés',
    'M=1:50'
  ].join('\n');
  const blocks = retegekFromText(text,'','EK-04 Metszetek.pdf');
  assert.deepEqual(blocks.map(block => block.id),['T1','M1'],
    'A Mennyezet címsor saját blokk, nem a Magastető folytatása.');
  const facts = retegrendFacts({planTexts:[{name:'EK-04 Metszetek.pdf',text}]});
  assert.equal(facts.roof?.id,'T1');
  assert.equal(facts.slab?.id,'M1');
  const values = retegrendValues(facts);
  assert.equal(values['retegrend:fodem'],'fafödém',
    'Betonréteg nélkül a födém fafödém.');
  assert.match(values['retegrend:teto'],/kerámia cserép fedés/);
  assert.equal(values['retegrend:teto'].includes('30/50'),false,
    'A héjalásnál a szarufaméret nem kerül a fedés szövegébe.');
});

test('A szóhatáros kimenetből a rétegrend-oszlop olvasható, a rajzi szöveg nélkül', () => {
  const word = (x,y,x2,text) => `<word xMin="${x}" yMin="${y}" xMax="${x2}" yMax="${y + 10}">${text}</word>`;
  const html = '<page width="2000" height="2000">' + [
    word(100,100,150,'Rétegrendek:'),
    word(100,120,110,'F1'),word(115,120,180,'Határoló'),word(185,120,200,'fal'),
    word(100,140,120,'30'),word(125,140,135,'cm'),word(140,140,200,'Porotherm'),
    word(500,140,520,'M'),word(530,140,540,'='),word(550,140,560,'1:50')
  ].join('') + '</page>';
  const blocks = retegekFromText('','','EK-04 Metszetek.pdf',html);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].title,'F1 Határoló fal');
  assert.deepEqual(blocks[0].layers,[{thickness:'30 cm',material:'Porotherm'}],
    'A rajzi felirat (M = 1:50) nem kerülhet a rétegrendbe.');
});

test('A rétegrend blokk a „---” jelnél véget ér', () => {
  const word = (x,y,text) => `<word xMin="${x}" yMin="${y}" xMax="${x + 60}" yMax="${y + 10}">${text}</word>`;
  const html = '<page width="2000" height="2000">' + [
    word(100,100,'Rétegrendek'),
    word(100,120,'F1'),word(115,120,'Határoló'),word(185,120,'fal'),
    word(100,140,'30'),word(125,140,'cm'),word(140,140,'Porotherm'),
    word(100,160,'---'),
    word(100,180,'Rajzi'),word(115,180,'felirat')
  ].join('') + '</page>';
  const blocks = retegekFromText('','','EK-04 Metszetek.pdf',html);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].title,'F1 Határoló fal');
  assert.deepEqual(blocks[0].layers,[{thickness:'30 cm',material:'Porotherm'}],
    'A „---” utáni rajzi felirat nem kerülhet a rétegrendbe.');
});

test('A födém betonréteg nélkül fafödém, betonnal a betonréteg a szerkezet', () => {
  const timber = ['Rétegrendek:','M1 Mennyezet','25 cm kőzetgyapot hőszigetelés',
    '2 cm gipszkarton álmennyezet','É'].join('\n');
  const timberFacts = retegrendFacts({planTexts:[{name:'EK-04 Metszetek.pdf',text:timber}]});
  assert.equal(timberFacts.slab.material,'fafödém');
  assert.equal(timberFacts.slab.thickness,'');
  const concrete = ['Rétegrendek:','M1 Födém','20 cm vasbeton födém',
    '4 cm aljzatbeton','É'].join('\n');
  const concreteFacts = retegrendFacts({planTexts:[{name:'EK-04 Metszetek.pdf',text:concrete}]});
  assert.match(concreteFacts.slab.material,/vasbeton/);
  assert.equal(concreteFacts.slab.thickness,'20 cm');
});
