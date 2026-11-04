'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {hasExistingData,hasFloorAreaRatio,findDataTable,cellHasData,technicalTableRequests} =
  require('../server/technical_table.cjs');

const key = cell => `TERVEZESI_ADATOK:Munkalap1!${cell}`;
const cell = (text,startIndex) => ({content:[{paragraph:{
  elements:[{startIndex,textRun:{content:text}}]}}]});

// A sablon „Tervezési adatok” táblázata: fejléc, szintterületi mutató,
// építménymagasság és telekterület sor, benne a törölhető „Meglévő” oszloppal.
function documentWithTable() {
  const row = (index,cells) => ({tableCells:cells.map((text,column) =>
    cell(text,1000+index*400+column*80))});
  const header = row(0,['Megnevezés','Megengedett:','Meglévő','Tervezett:']);
  const floorArea = row(1,['Szintterületi mutató',`{{${key('B7')}}}`,`{{${key('L7')}}}`,`{{${key('M7')}}}`]);
  const height = row(2,['Építménymagasság',`{{${key('B6')}}}`,`{{${key('E6')}}}`,`{{${key('F6')}}}`]);
  return {body:{content:[
    {startIndex:1,paragraph:{elements:[{startIndex:1,textRun:{content:'Adatok\n'}}]}},
    {startIndex:200,table:{tableRows:[header,floorArea,height]}}
  ]}};
}

test('A tervezési adatok táblázata a fejlécéről azonosítható', () => {
  const table = findDataTable(documentWithTable());
  assert.equal(table.startIndex,200);
  assert.equal(table.rows.length,3);
  assert.equal(table.rows[0][2],'Meglévő');
  assert.equal(findDataTable({body:{content:[]}}),null);
});

test('Üres adatnál a teljes oszlop és minden adat nélküli sor törlődik', () => {
  const requests = technicalTableRequests(documentWithTable(),{});
  assert.equal(requests.length,3);
  // Először az oszlop, majd a sorok alulról felfelé.
  assert.deepEqual(requests[0],{deleteTableColumn:{tableCellLocation:{
    tableStartLocation:{index:200},rowIndex:0,columnIndex:2}}});
  assert.deepEqual(requests.slice(1),[
    {deleteTableRow:{tableCellLocation:{tableStartLocation:{index:200},rowIndex:2,columnIndex:0}}},
    {deleteTableRow:{tableCellLocation:{tableStartLocation:{index:200},rowIndex:1,columnIndex:0}}}
  ]);
});

test('Meglévő épület adata és B7 követelmény esetén a táblázat érintetlen', () => {
  assert.deepEqual(technicalTableRequests(documentWithTable(),{
    [key('E6')]:'5,5',[key('E8')]:'2',[key('E9')]:'1',
    [key('L2')]:'20%',[key('L5')]:'40%',[key('L7')]:'0,8',[key('B7')]:'0,9'
  }),[]);
});

test('A meglévő oszlop csak akkor marad, ha van meglévő épületadat', () => {
  assert.equal(hasExistingData({[key('E8')]:'2'}),true);
  assert.equal(hasExistingData({[key('E6')]:'  '}),false);
  // A telek területe nem számít meglévő épületadatnak.
  assert.equal(hasExistingData({[key('E2')]:'1000'}),false);
  assert.equal(hasFloorAreaRatio({[key('B7')]:'0,9'}),true);
  assert.equal(hasFloorAreaRatio({[key('B7')]:''}),false);
  const requests = technicalTableRequests(documentWithTable(),{[key('F8')]:'3'});
  assert.equal(requests.length,3,
    'A tervezett érték nem pótolja a meglévő oszlopot, és a két adat nélküli sor törlődik.');
});

test('A csak tervezett értéket tartalmazó sor megmarad', () => {
  const requests = technicalTableRequests(documentWithTable(),{
    [key('F6')]:'5,5',[key('B7')]:'0,9'
  });
  assert.deepEqual(requests,[{deleteTableColumn:{tableCellLocation:{
    tableStartLocation:{index:200},rowIndex:0,columnIndex:2}}}]);
  assert.equal(cellHasData(`{{${key('F6')}}}`,{[key('F6')]:'5,5'}),true);
  assert.equal(cellHasData(`{{${key('E6')}}}`,{[key('E6')]:''}),false);
  assert.equal(cellHasData('max. 6 m',{}),true);
});

test('A már igazított táblázaton a művelet ismételve sem módosít', () => {
  const doc = {body:{content:[{startIndex:200,table:{tableRows:[
    {tableCells:[cell('Megnevezés',201),cell('Megengedett:',230),cell('Tervezett:',260)]},
    {tableCells:[cell('Építménymagasság',300),cell('max. 6 m',340),cell('5,5 m',380)]}
  ]}}]}};
  assert.deepEqual(technicalTableRequests(doc,{[key('B7')]:'0,9'}),[]);
});

test('Előírás nélkül a szintterületi mutató sora a tervezett értékkel együtt is kimarad', () => {
  const requests = technicalTableRequests(documentWithTable(),{[key('M7')]:'0,16'});
  assert.ok(requests.some(request =>
    request.deleteTableRow?.tableCellLocation.rowIndex === 1),
    'B7 nélkül a szintterületi mutató sora nem maradhat a táblázatban.');
});
