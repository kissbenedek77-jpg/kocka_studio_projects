'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {layoutRequests,styleRequests,findTable,fillRequests} =
  require('../server/room_table.cjs');

const para = (start,text) => ({startIndex:start,endIndex:start+text.length,
  paragraph:{elements:[{startIndex:start,textRun:{content:text}}]}});

function cell(start,text = '') {
  const content = [para(start,text)];
  return {content,startIndex:start,endIndex:start+text.length+1};
}

// A helyiséglista oszlopai: 7 cm és 2 cm, a táblázat 9 cm.
// 1 cm = 72 / 2,54 = 28,3465 PT.
const CM = 72 / 2.54;

test('A helyiséglista oszlopai 7 cm és 2 cm, a táblázat 9 cm széles', () => {
  const requests = layoutRequests(300);
  const widths = requests.filter(request => request.updateTableColumnProperties)
    .map(request => request.updateTableColumnProperties.tableColumnProperties.width.magnitude);
  assert.equal(widths.length,2);
  assert.equal(widths[0],198.43,'A megnevezés oszlop 7 cm: '+widths[0]);
  assert.equal(widths[1],56.69,'A terület oszlop 2 cm: '+widths[1]);
  assert.equal(Math.round((widths[0] + widths[1]) * 100) / 100,255.12,
    'A táblázat 9 cm (255,12 PT).');
  assert.ok(Math.abs(widths[0] - 7 * CM) < 0.01,'7 cm = '+(7 * CM)+' PT');
  assert.ok(Math.abs(widths[1] - 2 * CM) < 0.01,'2 cm = '+(2 * CM)+' PT');
  const padding = requests.find(request => request.updateTableCellStyle)
    .updateTableCellStyle.tableCellStyle;
  // 0,1 cm = 2,83 PT
  for (const side of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])
    assert.equal(padding[side].magnitude,2.83,side);
  assert.deepEqual(requests[0].updateTableColumnProperties.tableStartLocation,{index:300});
});

test('A terület jobbra igazított, az alszummák behúzottak', () => {
  const rows = ['header','floor','room','subtotal','total']
    .map(kind => ({tableCells:[cell(100,kind),cell(200,'8,25')]}));
  const requests = styleRequests({table:{tableRows:rows}},rows.map(row =>
    row.tableCells[0].content[0].paragraph.elements[0].textRun.content));
  const paragraphs = requests.filter(request => request.updateParagraphStyle)
    .map(request => request.updateParagraphStyle);
  // A terület oszlop minden sorban jobbra igazodik.
  assert.equal(paragraphs.filter(item => item.paragraphStyle.alignment === 'END').length,5);
  // A helyiségnevek behúzását a cella szövege adja (5 szóköz); csak az alszummák 1 cm-rel beljebb.
  assert.deepEqual(paragraphs.filter(item => item.paragraphStyle.indentStart)
    .map(item => [item.range.startIndex,item.paragraphStyle.indentStart.magnitude]),[[100,28.35]],
    'Csak az alszummák behúzottak, kb. 1 cm-rel.');
  const texts = requests.filter(request => request.updateTextStyle);
  assert.equal(texts.length,6,'A fejléc, az alszummák és a teljes összeg mindkét cellája félkövér.');
  const total = texts.filter(item => item.updateTextStyle.textStyle.fontSize);
  assert.equal(total.length,2,'A teljes összeg mindkét cellája nagyobb betűvel jelenik meg.');
  assert.ok(total.every(item => item.updateTextStyle.textStyle.fontSize.magnitude === 11));
  assert.ok(total.every(item => item.updateTextStyle.textStyle.bold === true));
  assert.ok(texts.filter(item => !item.updateTextStyle.textStyle.fontSize)
    .every(item => item.updateTextStyle.textStyle.bold === true));
});

test('A feltöltött táblázat a kezdő indexe alapján újrakereshető', () => {
  const table = {startIndex:300,endIndex:301,table:{tableRows:[]}};
  const document = {body:{content:[{paragraph:{elements:[]}},table,
    {startIndex:600,endIndex:601,table:{tableRows:[]}}]}};
  assert.equal(findTable(document,300),table);
  assert.equal(findTable(document,400),null);
  assert.equal(findTable({},300),null);

  const filled = {startIndex:300,endIndex:301,table:{tableRows:[
    {tableCells:[cell(310,'Helyiség'),cell(320,'Terület (m²)')]}]}};
  const requests = fillRequests(filled,[['Helyiség','Terület (m²)']]);
  assert.equal(requests.filter(request => request.insertText).length,2);
});
