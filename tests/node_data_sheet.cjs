'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Projektadatlap másolata az írásos mappába kerül és Node dashboard-linket kap', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const row = Array(40).fill(''); row[0] = 'ABC123'; row[4] = 'Projekt mappa';
  const folderNames = ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  let copied; let linkUpdate; let formulaUpdate; let fieldUpdate;
  google.sheets = () => ({spreadsheets:{
    get: async options => options.includeGridData ? {data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/root-folder-id'}]}]}]}]}} :
      {data:{sheets:[{properties:{sheetId:5,title:'Generálás'}}]}},
    batchUpdate: async options => {linkUpdate = options; return {data:{}};},
    values:{get:async () => ({data:{values:[row]}}),
      batchUpdate:async options => {formulaUpdate=options; return {data:{}};},
      update:async options => {fieldUpdate=options; return {data:{}};}}
  }});
  google.drive = () => ({files:{
    get:async options => ({data:{id:options.fileId,name:'Projekt A',
      mimeType:'application/vnd.google-apps.folder',parents:['parent-id']}}),
    list:async options => ({data:{files:options.q.includes('root-folder-id') ?
      folderNames.map((name,index) => ({id:index ? `sub-${index}` : 'written-id',name,
        mimeType:'application/vnd.google-apps.folder'})) : []}}),
    copy:async options => {copied = options; return {data:{id:'data-sheet-id',
      name:options.requestBody.name,mimeType:'application/vnd.google-apps.spreadsheet'}};}
  }});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'data-sheet-test',sheetName:'Adatok',projectDataTemplateId:'template-sheet-id'});
    const sheet = await client.ensureProjectDataSheet('ABC123');
    assert.equal(sheet.id, 'data-sheet-id');
    assert.equal(copied.fileId, 'template-sheet-id');
    assert.deepEqual(copied.requestBody.parents, ['written-id']);
    assert.equal(linkUpdate.spreadsheetId, 'data-sheet-id');
    const link = linkUpdate.requestBody.requests[0].updateCells.rows[0].values[1]
      .textFormatRuns[0].format.link.uri;
    assert.equal(link, 'https://node.example/dashboard?project=ABC123');
    assert.equal(formulaUpdate.requestBody.valueInputOption,'USER_ENTERED');
    assert.deepEqual(formulaUpdate.requestBody.data.map(item => item.range),
      ["'Munkalap1'!J2","'Munkalap1'!H5","'Munkalap1'!J5"]);
    assert.equal(fieldUpdate.requestBody.values[0][0],'Mező');
    assert.equal(fieldUpdate.requestBody.values[1][0],'TERV_TARGYA');
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
