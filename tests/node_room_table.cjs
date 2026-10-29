'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {MARKER,findMarker,insertRequests,findEmptyTable,fillRequests} = require('../server/room_table.cjs');

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
