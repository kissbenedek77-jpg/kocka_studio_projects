'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {googleClient} = require('../server/google.cjs');

const config = {
  clientId: 'client-id', clientSecret: 'client-secret',
  baseUrl: 'https://example.test', sheetId: 'SHEET', sheetName: 'Adatok'
};

// A szerver moduljai ezeket a kliensmetódusokat hívják; bármelyik kimaradása futásidejű hibát okoz.
const REQUIRED = [
  'values', 'valuesIn', 'updateIn', 'appendIn', 'clearIn', 'batchUpdateIn', 'batchGet',
  'update', 'append', 'clear',
  'spreadsheet', 'getSheetId', 'ensureSheet', 'sheetRows', 'appendSheet', 'updateSheetRow',
  'cellLink', 'setCellLink',
  'allRows', 'project', 'file', 'listChildren', 'findChild', 'createFolder', 'ensureFolder',
  'copyFile', 'moveFile', 'trashFile', 'renameFile', 'downloadFile', 'exportPdf',
  'createFile', 'uploadFile', 'withPublicRead',
  'getDoc', 'batchUpdateDoc', 'folderFor', 'listProjects', 'isClosed'
];

test('A Google-kliens minden használt metódust kitesz', () => {
  const google = googleClient(config);
  const missing = REQUIRED.filter(name => typeof google[name] !== 'function');
  assert.deepEqual(missing, [], 'hiányzó kliensmetódus: ' + missing.join(', '));
});

test('A cellLink a hyperlinket, majd a rich text linket adja vissza', async () => {
  const google = googleClient(config);
  const requests = [];
  google.sheets.spreadsheets.get = async request => {
    requests.push(request);
    return {data: {sheets: [{data: [{rowData: [{values: [
      {hyperlink: 'https://drive.google.com/drive/folders/ABC123456789'}
    ]}]}]}]}};
  };
  assert.equal(await google.cellLink(2, 5), 'https://drive.google.com/drive/folders/ABC123456789');
  assert.equal(requests[0].spreadsheetId, 'SHEET');
  assert.equal(requests[0].ranges[0], "'Adatok'!E2");
  assert.equal(requests[0].includeGridData, true);

  google.sheets.spreadsheets.get = async () => ({data: {sheets: [{data: [{rowData: [{values: [
    {textFormatRuns: [{format: {link: {uri: 'https://drive.google.com/drive/folders/XYZ987654321'}}}]}
  ]}]}]}]}});
  assert.equal(await google.cellLink(3, 5), 'https://drive.google.com/drive/folders/XYZ987654321');

  google.sheets.spreadsheets.get = async () => ({data: {sheets: []}});
  assert.equal(await google.cellLink(4, 5), '');
});
