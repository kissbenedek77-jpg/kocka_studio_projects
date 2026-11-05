'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {templateOutline,blockOverrides,blockRequests} =
  require('../server/technical_blocks.cjs');

function paragraph(text, style = 'NORMAL_TEXT', start = 0) {
  return {
    paragraph: {
      elements: [{textRun: {content: text + '\n'}}],
      paragraphStyle: {namedStyleType: style}
    },
    startIndex: start,
    endIndex: start + text.length + 1
  };
}

function documentWith(items) {
  return {body: {content: items}, namedRanges: {}};
}

test('A sablon kirajzolása a dokumentum sorrendjét követi', () => {
  const doc = documentWith([
    paragraph('Címlap', 'NORMAL_TEXT', 0),
    paragraph('Adatok', 'NORMAL_TEXT', 7),
    paragraph('Építés jellege: {{EPITES_JELLEGE}}', 'NORMAL_TEXT', 14),
    paragraph('Fix szöveg', 'NORMAL_TEXT', 45)
  ]);
  doc.body.content[1].paragraph.bullet = {};
  const outline = templateOutline(doc, {manualKeys: ['EPITES_JELLEGE']});
  assert.deepEqual(outline.entries.map(item => item.type),
    ['text', 'heading', 'fields', 'text']);
  assert.equal(outline.entries[0].id, 'b0');
  assert.equal(outline.entries[1].text, 'Adatok');
  assert.deepEqual(outline.entries[2].keys, ['EPITES_JELLEGE']);
  assert.deepEqual(outline.blocks.map(item => item.id), ['b0', 'b1', 'b3']);
  assert.deepEqual(outline.missingFields, []);
});

test('A táblázatban álló mezők a táblázat helyén jelennek meg', () => {
  const cell = content => ({content});
  const table = {
    table: {
      tableRows: [{tableCells: [
        cell([paragraph('Építményérték', 'NORMAL_TEXT', 100)]),
        cell([paragraph('{{SZAMITOTT_EPITMENYERTEK}}', 'NORMAL_TEXT', 120)])
      ]}]
    }
  };
  const doc = documentWith([
    paragraph('Építményérték számítása', 'NORMAL_TEXT', 0),
    table
  ]);
  const outline = templateOutline(doc, {manualKeys: ['SZAMITOTT_EPITMENYERTEK']});
  const types = outline.entries.map(item => item.type);
  assert.deepEqual(types, ['text', 'table', 'fields']);
  assert.deepEqual(outline.entries[2].keys, ['SZAMITOTT_EPITMENYERTEK']);
  assert.deepEqual(outline.missingFields, []);
});

test('A blokkfelülírás és a visszaállítás a megfelelő bekezdést cseréli', () => {
  const doc = documentWith([
    paragraph('Cím', 'HEADING_3', 0),
    paragraph('Fix szöveg', 'NORMAL_TEXT', 5)
  ]);
  const outline = templateOutline(doc, {manualKeys: []});
  const override = blockRequests(doc, outline.blocks, new Map([['b1', 'Új szöveg']]));
  assert.equal(override.applied, 1);
  assert.deepEqual(override.requests[0], {
    deleteContentRange: {range: {startIndex: 5, endIndex: 15}}
  });
  assert.deepEqual(override.requests[1], {
    insertText: {location: {index: 5}, text: 'Új szöveg'}
  });

  const generated = documentWith([
    paragraph('Cím', 'HEADING_3', 0),
    paragraph('Új szöveg', 'NORMAL_TEXT', 5)
  ]);
  const reset = blockRequests(generated, outline.blocks, new Map([['b1', '']]));
  assert.equal(reset.applied, 1);
  assert.deepEqual(reset.requests[1], {
    insertText: {location: {index: 5}, text: 'Fix szöveg'}
  });
});

test('A blokkfelülírások olvasása az üres visszaállítási sort is megtartja', () => {
  const rows = [['b1', 'Új szöveg', 'Fix szöveg', ''],
    ['b2', '', 'Másik szöveg', ''], ['nem-blokk', 'x', '', '']];
  const overrides = blockOverrides(rows);
  assert.equal(overrides.get('b1'), 'Új szöveg');
  assert.equal(overrides.get('b2'), '');
  assert.equal(overrides.has('nem-blokk'), false);
});
