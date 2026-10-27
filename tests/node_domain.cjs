'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const {FIELDS, rowToData, projectFromRow, extractDriveId} = domain;
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

test('Projektmappanév és fájlnév-utótag a meglévő szabályok szerint képződik', () => {
  const data = {projekt_varos: 'Magyaratád', projekt_kozterulet: 'Kossuth', projekt_tipus: 'utca', projekt_hazszam: '531'};
  assert.equal(domain.buildProjectFolderName(data), 'Magyaratád Kossuth utca 531');
  assert.equal(domain.buildProjectFolderName({}), '');
  assert.equal(domain.appendProjectPostfix('Terv.pdf', 'MOD_2609'), 'Terv - MOD_2609.pdf');
  assert.equal(domain.appendProjectPostfix('Mappa - MOD_2609', 'MOD_2609'), 'Mappa - MOD_2609');
  assert.equal(domain.appendProjectPostfix('Mappa', 'MOD_2609'), 'Mappa - MOD_2609');
});

test('Feltételes dokumentumblokkok jelölése és kiértékelése', () => {
  assert.deepEqual(domain.parseConditionalMarker('{{#IF projekt Típus = Családi ház}}'),
    {type: 'start', field: 'projekt Típus', operator: '=', expected: 'Családi ház'});
  assert.deepEqual(domain.parseConditionalMarker('{{#IF Állampolgárság != Magyar}}'),
    {type: 'start', field: 'Állampolgárság', operator: '!=', expected: 'Magyar'});
  assert.deepEqual(domain.parseConditionalMarker('{{/IF}}'), {type: 'end'});
  assert.equal(domain.parseConditionalMarker('szöveg'), null);
  const values = {'projekt Típus': 'Családi ház', 'Állampolgárság': 'Magyar'};
  assert.equal(domain.conditionalMatches(domain.parseConditionalMarker('{{#IF projekt Típus = Családi ház}}'), values), true);
  assert.equal(domain.conditionalMatches(domain.parseConditionalMarker('{{#IF Állampolgárság != Magyar}}'), values), false);
  assert.equal(domain.conditionalMatches(domain.parseConditionalMarker('{{#IF Állampolgárság != Osztrák}}'), values), true);
});

test('Dokumentum-helyőrzők és dátumok a magyar formátumot használják', () => {
  const data = {
    uid: 'ABC', vezeteknev: 'Kiss', keresztnev: 'Anna', projektTipus: 'Családi ház',
    projekt_varos: 'Magyaratád', projekt_kozterulet: 'Kossuth', projekt_tipus: 'utca',
    projekt_hazszam: '531', adoazonosito: '123-456-7890', projektCim: 'Magyaratád 531'
  };
  const values = domain.getDocumentReplacements(data, {'Egyedi mező': 'érték'},
    new Date('2026-09-29T10:00:00Z'));
  assert.equal(values['Teljes név'], 'Kiss Anna');
  assert.equal(values['Adóazonosító'], '1234567890');
  assert.equal(values['Projekt azonosító'], 'Magyaratád Kossuth utca 531');
  assert.equal(values['Mai dátum'], '2026. 09. 29.');
  assert.equal(values['Egyedi mező'], 'érték');
  assert.equal(domain.formatDate(new Date('2026-09-29T22:30:00Z')), '2026-09-30');
  assert.equal(domain.getDefaultRestartPostfix(new Date('2026-09-29T10:00:00Z')), 'MOD_2609');
});
