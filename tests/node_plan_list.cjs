'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {MARKER,rightEdge,planRows,layoutRequests,alignRequests,findTable} =
  require('../server/plan_list.cjs');

// A tervjegyzék keret és cellakitöltés nélküli, kétdobozos táblázat: a bal
// cellában a tervlap címe, a jobb cellában a lépték a lap jobb széléhez
// igazítva. A kérések a Google Docs API alakját követik.

const A4_STYLE = {pageSize:{width:{magnitude:595.28,unit:'PT'}},
  marginLeft:{magnitude:70.85,unit:'PT'},marginRight:{magnitude:70.85,unit:'PT'}};

const para = (start,content) => ({startIndex:start,endIndex:start+content.length,
  paragraph:{elements:[{startIndex:start,textRun:{content}}]}});
const cell = (start,text = '') => ({content:[para(start,text)]});
const tableItem = (start,rows) => ({startIndex:start,endIndex:start+1,
  table:{tableRows:rows.map(row => ({tableCells:row.map(start2 => cell(start2))}))}});

test('A tervjegyzék sorai címből és léptékből állnak, a lépték elmaradhat', () => {
  const rows = planRows('EK-01 Helyszínrajz\tM=1:200\nscan_0012\nEK-02 Metszet\tM=1:100\n');
  assert.deepEqual(rows,[['EK-01 Helyszínrajz','M=1:200'],['scan_0012',''],
    ['EK-02 Metszet','M=1:100']]);
  assert.deepEqual(planRows(''),[]);
  assert.deepEqual(planRows(null),[]);
});

test('A táblázat a szövegtükör teljes szélességét kitölti, a lépték a jobb szélen', () => {
  const width = rightEdge(A4_STYLE);
  assert.ok(Math.abs(width-453.58) < 0.05,'A szövegtükör szélessége: '+width);
  assert.equal(rightEdge(),rightEdge({}),'Stílus nélkül az A4-es alapérték érvényes.');
  assert.ok(rightEdge() > 400);
  const requests = layoutRequests(56,A4_STYLE);
  const columns = requests.filter(request => request.updateTableColumnProperties)
    .map(request => request.updateTableColumnProperties);
  assert.deepEqual(columns.map(item => item.columnIndices[0]),[0,1]);
  assert.equal(columns[0].tableStartLocation.index,56);
  assert.equal(columns[0].tableColumnProperties.widthType,'FIXED_WIDTH');
  assert.ok(Math.abs(columns[0].tableColumnProperties.width.magnitude+
    columns[1].tableColumnProperties.width.magnitude-width) < 0.05,
  'A két oszlop együtt a szövegtükör szélessége.');
  assert.ok(columns[1].tableColumnProperties.width.magnitude <= 120,
    'A lépték oszlopa keskeny.');
  const style = requests.find(request => request.updateTableCellStyle).updateTableCellStyle;
  assert.equal(style.tableStartLocation.index,56);
  for (const border of ['borderTop','borderBottom','borderLeft','borderRight'])
    assert.equal(style.tableCellStyle[border].width.magnitude,0,'A keret nem látható.');
  for (const padding of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])
    assert.equal(style.tableCellStyle[padding].magnitude,0,'A cellakitöltés nulla.');
  assert.equal(style.tableCellStyle.contentAlignment,'TOP');
  assert.match(style.fields,/paddingTop/);
});

test('A lépték cellája jobbra igazított, a cím cellája érintetlen', () => {
  const table = tableItem(300,[[310,340],[360,390]]);
  const requests = alignRequests(table);
  assert.equal(requests.length,2);
  assert.equal(requests[0].updateParagraphStyle.paragraphStyle.alignment,'END');
  assert.equal(requests[0].updateParagraphStyle.fields,'alignment');
  assert.deepEqual(requests.map(request => request.updateParagraphStyle.range.startIndex),
    [340,390]);
  assert.deepEqual(alignRequests(null),[]);
});

test('A beszúrt táblázat a kezdő indexe alapján újrakereshető', () => {
  const first = tableItem(100,[[110,130]]);
  const document = {body:{content:[para(1,'Bevezető\n'),first,tableItem(300,[[310,340]])]}};
  assert.equal(findTable(document,300).startIndex,300);
  assert.equal(findTable(document,999),null);
});
