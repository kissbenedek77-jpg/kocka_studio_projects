'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {MARKER,findMarker,insertRequests,findEmptyTable,fillRequests,
  layoutRequests,rowStyleRequests,styleRequests,findTable} = require('../server/room_table.cjs');

const para = (start,content) => ({startIndex:start,endIndex:start+content.length,
  paragraph:{elements:[{startIndex:start,textRun:{content}}]}});

function cell(start,text = '') {
  const content = [para(start,text)];
  return {content,startIndex:start,endIndex:start+text.length+1};
}

function table(start,rows,columns = 2) {
  const tableRows = rows.map((row,rowIndex) => ({tableCells:row.map((start,columnIndex) =>
    cell(start,rowIndex === 0 && columnIndex === 0 ? '' : ''))}));
  return {startIndex:start,endIndex:start+1,table:{tableRows}};
}

test('A helyiséglista jelölője megtalálható és táblázat kérése készül', () => {
  const document = {body:{content:[para(1,'Bevezető\n'),para(20,'  '+MARKER+' \n')]}};
  const marker = findMarker(document);
  assert.equal(marker.startIndex,22);
  const requests = insertRequests(marker,[['Helyiség','Terület (m²)'],['Földszint',''],['Mindösszesen','8,25']]);
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0].deleteContentRange.range,{startIndex:22,endIndex:22+MARKER.length});
  assert.deepEqual(requests[1].insertTable,{location:{index:22},rows:3,columns:2});
  assert.deepEqual(insertRequests(null,[['a','b']]),[]);
  assert.equal(findMarker({body:{content:[para(1,'más szöveg\n')]}}),null);
  // A tervjegyzék egyetlen tervlapnál is táblázat, ezért ott egy sor is elég.
  assert.deepEqual(insertRequests({startIndex:5,endIndex:20},[['EK-01','M=1:200']]),[],
    'A helyiséglistánál az egy soros táblázat nem értelmes.');
  const single = insertRequests({startIndex:5,endIndex:20},[['EK-01','M=1:200']],2,
    {allowSingleRow:true});
  assert.equal(single.length,2);
  assert.equal(single.find(request => request.insertTable).insertTable.rows,1);
});

test('A fejléc nélküli táblázat első sora nem lesz félkövér', () => {
  const rows = [['EK-01 Helyszínrajz','M=1:200']];
  const filled = {startIndex:500,endIndex:501,table:{tableRows:[
    {tableCells:[cell(510),cell(520)]}]}};
  const requests = fillRequests(filled,rows,{header:false});
  assert.equal(requests.filter(request => request.updateTextStyle).length,0);
  assert.equal(requests.filter(request => request.insertText).length,2);
});

test('A beszúrt üres táblázat azonosítható és a cellák feltöltése helyes', () => {
  const rows = [['Helyiség','Terület (m²)'],['Földszint',''],['Mindösszesen','8,25']];
  const empty = table(500,[[0,0],[0,0],[0,0]]);
  const document = {body:{content:[para(1,'Bevezető\n'),empty,
    table(900,[[0,0],[0,0],[0,0],[0,0]])]}};
  const found = findEmptyTable(document,rows);
  assert.equal(found,empty,'A 3 soros, 2 oszlopos üres táblázat kell.');
  assert.equal(findEmptyTable(document,[['a','b']]),null);

  const filled = {startIndex:500,endIndex:501,table:{tableRows:[
    {tableCells:[cell(510),cell(520)]},
    {tableCells:[cell(530),cell(540)]},
    {tableCells:[cell(550),cell(560)]}
  ]}};
  const requests = fillRequests(filled,rows);
  const inserts = requests.filter(request => request.insertText);
  assert.equal(inserts.length,5,'Az üres terület-cellába nem kerül szöveg.');
  assert.deepEqual(inserts.map(request => request.insertText.location.index)
    .sort((a,b) => a-b),[510,520,530,550,560]);
  const bold = requests.filter(request => request.updateTextStyle);
  assert.deepEqual(bold.map(item => item.updateTextStyle.range).sort((a,b) => a.startIndex-b.startIndex),
    [{startIndex:510,endIndex:510+'Helyiség'.length},
      {startIndex:520,endIndex:520+'Terület (m²)'.length}]);
  assert.equal(bold.length,2,'A fejléc mindkét cellája félkövér.');
  // A kérések indexe csökkenő sorrendű, hogy a beszúrás ne tolja el a többit.
  const indexes = requests.map(request => request.insertText?.location.index ??
    request.deleteContentRange?.range.startIndex ?? request.updateTextStyle.range.startIndex);
  assert.deepEqual(indexes,[...indexes].sort((a,b) => b-a));
});

test('A helyiség neve előtti 5 szóköz behúzásként megmarad', () => {
  const filled = {startIndex:500,endIndex:501,table:{tableRows:[
    {tableCells:[cell(510),cell(520)]},
    {tableCells:[cell(530),cell(540)]}]}};
  const rows = [['Helyiség','Terület (m²)'],['     nappali','26,07']];
  const requests = fillRequests(filled,rows,{trim:false});
  const inserted = requests.filter(request => request.insertText)
    .map(request => request.insertText.text);
  assert.ok(inserted.includes('     nappali'),
    'A cella szövege megőrzi a név előtti 5 szóközt.');
  const trimmed = fillRequests(filled,rows);
  assert.equal(trimmed.filter(request => request.insertText)
    .some(request => request.insertText.text === '     nappali'),false,
    'A tervjegyzéknél a szöveget továbbra is levágtuk.');
});

test('A helyiséglista sorai nem törhetnek át az oldalhatáron', () => {
  const requests = rowStyleRequests(300,5);
  assert.equal(requests.length,1);
  const style = requests[0].updateTableRowStyle;
  assert.deepEqual(style.tableStartLocation,{index:300});
  assert.deepEqual(style.rowIndices,[0,1,2,3,4]);
  assert.equal(style.tableRowStyle.preventOverflow,true);
  assert.equal(style.fields,'preventOverflow');
  assert.deepEqual(rowStyleRequests(300,0),[]);
});

