'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {valueTableRequests,findValueTable,parseNumber,replaceNumber} =
  require('../server/value_table.cjs');

const para = (start,text) => ({startIndex:start,endIndex:start+text.length,
  paragraph:{elements:[{startIndex:start,textRun:{content:text}}]}});

function cell(start,text = '') {
  const content = [para(start,text)];
  return {content,startIndex:start,endIndex:start+text.length+1};
}

// A sablon építményérték-táblázata: minta adatsor + MINDÖSSZESEN sor.
function valueTable(start,firstRow,totalRow = ['MINDÖSSZESEN','','','','']) {
  let index = start;
  const rows = [firstRow,totalRow].map(row => ({tableCells:row.map(text => {
    const tableCell = cell(index,text);
    index += text.length + 1;
    return tableCell;
  })}));
  return {startIndex:start,endIndex:start+1,table:{tableRows:rows}};
}

const textOf = requests => requests.filter(request => request.insertText)
  .map(request => request.insertText.text);

test('A minta alapján a cím, az egységár és a terület×egységár érték bekerül', () => {
  const table = valueTable(100,['1. Lakó, üdülő, kulturális rendeltetésre szolgáló épület, épületrész',
    'nettó alapterület / m²','600','45.28 m²','']);
  const result = valueTableRequests({body:{content:[table]}});
  assert.ok(result,'A táblázat felismerhető.');
  assert.deepEqual(result.rows.map(row => [row.price,row.area,row.value]),
    [[600,45.28,27168]]);
  const texts = textOf(result.requests);
  assert.ok(texts.includes('45,28 m²'),'A terület magyar alakban: '+texts);
  assert.ok(texts.includes('27 168 E Ft'),'Az érték a terület × egységár: '+texts);
  assert.equal(result.total,27168);
  // A MINDÖSSZESEN sor ugyanazt az összeget kapja.
  assert.equal(texts.filter(text => text === '27 168 E Ft').length,2);
});

test('Az üres cím és egységár a jogszabályi mintából töltődik', () => {
  const table = valueTable(100,['','nettó alapterület / m²','','12,50 m²','']);
  const result = valueTableRequests({body:{content:[table]}},{fallback:[
    {label:'Lakó, üdülő, kulturális rendeltetésre szolgáló épület, épületrész',price:'600'}
  ]});
  const texts = textOf(result.requests);
  assert.ok(texts.includes('Lakó, üdülő, kulturális rendeltetésre szolgáló épület, épületrész'));
  assert.ok(texts.includes('600'));
  assert.ok(texts.includes('7 500 E Ft'),'12,50 × 600 = 7 500: '+texts);
  assert.equal(result.total,7500);
});

test('Terület nélkül nincs számítás, és a helyiséglista táblázata nem építményérték', () => {
  const empty = valueTable(100,['','','600','','']);
  const result = valueTableRequests({body:{content:[empty]}});
  assert.deepEqual(result.requests,[]);
  assert.deepEqual(result.rows,[]);
  // A helyiséglista utolsó sora „Mindösszesen”, ezért nem téveszthető össze.
  const room = valueTable(100,['Helyiség','Terület (m²)','','',''],['Mindösszesen','8,25']);
  assert.equal(findValueTable({body:{content:[room]}}),null);
  assert.equal(valueTableRequests({body:{content:[{paragraph:{elements:[]}}]}}),null);
});

test('Az érték oszlop mindig „E Ft” utótagot kap', () => {
  // A minta értékcellájában csak szám áll: a kitöltés után „E Ft” utótag kell.
  const table = valueTable(100,['1. Lakó, üdülő rendeltetésre szolgáló épület, épületrész',
    'nettó alapterület / m²','600','10,00 m²','6 000'],['MINDÖSSZESEN','','','','6 000']);
  const result = valueTableRequests({body:{content:[table]}});
  const texts = textOf(result.requests);
  assert.ok(texts.includes('6 000 E Ft'),'Az érték utótaggal: '+texts.join(' | '));
  assert.equal(texts.filter(text => /E Ft E Ft/.test(text)).length,0,
    'Nem duplázódik az utótag.');
  assert.equal(texts.filter(text => text === '6 000 E Ft').length,2,
    'A sor és a MINDÖSSZESEN is utótagot kap.');
});

test('A szám és a cella szövege magyar alakban jelenik meg', () => {
  assert.equal(parseNumber('45,28 m²'),45.28);
  assert.equal(parseNumber('1 234,5'),1234.5);
  assert.equal(parseNumber('45.28'),45.28);
  assert.equal(parseNumber(''),null);
  assert.equal(replaceNumber('45.28 m²',45.28,2),'45,28 m²');
  assert.equal(replaceNumber('600 E Ft/m²',600,0),'600 E Ft/m²');
  assert.equal(replaceNumber('',27168,0),'27 168');
});
