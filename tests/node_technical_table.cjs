'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {hasExistingData,hasFloorAreaRatio,findDataTable,technicalTableRequests} =
  require('../server/technical_table.cjs');

const key = cell => `TERVEZESI_ADATOK:Munkalap1!${cell}`;
const cell = (text,startIndex) => ({content:[{paragraph:{
  elements:[{startIndex,textRun:{content:text}}]}}]});

// A sablon 8 soros „Tervezési adatok” táblázata, benne a törölhető oszloppal
// és a feltételes szintterületi sorral.
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

test('Üres meglévő adatnál a teljes oszlop, B7 nélkül a szintterületi sor törlődik', () => {
  const requests = technicalTableRequests(documentWithTable(),{});
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0],{deleteTableColumn:{tableCellLocation:{
    tableStartLocation:{index:200},rowIndex:0,columnIndex:2}}});
  assert.deepEqual(requests[1],{deleteTableRow:{tableCellLocation:{
    tableStartLocation:{index:200},rowIndex:1,columnIndex:0}}});
});

test('Meglévő épület adata és B7 követelmény esetén a táblázat érintetlen', () => {
  assert.deepEqual(technicalTableRequests(documentWithTable(),{
    [key('E6')]:'5,5',[key('E8')]:'2',[key('E9')]:'1',
    [key('L2')]:'20%',[key('L5')]:'40%',[key('L7')]:'0,8',[key('B7')]:'0,9'
  }),[]);
});

test('Az oszlop csak akkor marad, ha minden meglévő adat üres', () => {
  assert.equal(hasExistingData({[key('E8')]:'2'}),true);
  assert.equal(hasExistingData({[key('E6')]:'  '}),false);
  assert.equal(hasFloorAreaRatio({[key('B7')]:'0,9'}),true);
  assert.equal(hasFloorAreaRatio({[key('B7')]:''}),false);
  const requests = technicalTableRequests(documentWithTable(),{[key('F8')]:'3'});
  assert.equal(requests.length,2,'A tervezett érték nem pótolja a meglévő oszlopot.');
});

test('A már igazított táblázaton a művelet ismételve sem módosít', () => {
  const doc = {body:{content:[{startIndex:200,table:{tableRows:[
    {tableCells:[cell('Megnevezés',201),cell('Megengedett:',230),cell('Tervezett:',260)]},
    {tableCells:[cell('Építménymagasság',300),cell('max. 6 m',340),cell('5,5 m',380)]}
  ]}}]}};
  assert.deepEqual(technicalTableRequests(doc,{[key('B7')]:'0,9'}),[]);
});
