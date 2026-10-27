'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {FIELDS, rowToData, projectFromRow, extractDriveId} = require('../server/domain.cjs');
const {extractFolderLinks} = require('../server/google.cjs');

test('A–AN mezők és projektadatok a meglévő sorrendben maradnak', () => {
  assert.equal(FIELDS.length, 40);
  const row = Array(40).fill('');
  row[0] = 'ABCD-1234'; row[2] = 'KÉSZ'; row[6] = 'TRUE';
  row[7] = 'Kiss'; row[8] = 'Benedek'; row[31] = 'Egyéb: felújítás'; row[38] = 'Magyaratád 531';
  const data = rowToData(row);
  assert.equal(data.projektTipus, 'Egyéb');
  assert.equal(data.projektTipusEgyeb, 'felújítás');
  assert.equal(data.gdprAccepted, true);
  const project = projectFromRow(row, 9);
  assert.equal(project.clientName, 'Kiss Benedek');
  assert.equal(project.name, 'Magyaratád 531');
  assert.equal(project.stage, 'closed');
  assert.equal(project.order, 9);
});

test('Drive mappaazonosító csak ismert hivatkozásból származik', () => {
  assert.equal(extractDriveId('https://drive.google.com/drive/folders/ABCdef123456_'), 'ABCdef123456_');
  assert.equal(extractDriveId('https://drive.google.com/open?id=ABCdef123456_'), 'ABCdef123456_');
  assert.equal(extractDriveId('https://example.com/nincs'), '');
});

test('A Sheet kattintható projektmappájának linkje a tényleges sorhoz kerül', () => {
  const links = extractFolderLinks([{data:[{startRow:1, rowData:[
    {values:[{hyperlink:'https://drive.google.com/drive/folders/ABCdef123456_'}]},
    {values:[{textFormatRuns:[{format:{link:{uri:'https://drive.google.com/drive/folders/XYZdef123456_'}}}]}]}
  ]}]}]);
  assert.equal(links.get(2), 'https://drive.google.com/drive/folders/ABCdef123456_');
  assert.equal(links.get(3), 'https://drive.google.com/drive/folders/XYZdef123456_');
});
