'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Node projektmappa létrehozás a Sheet E oszlopába kattintható linket ír', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const row = Array(40).fill('');
  row[0] = 'ABC123'; row[33] = 'Pécs'; row[34] = 'Fő'; row[35] = 'utca'; row[36] = '1';
  const created = [];
  let sheetUpdate;
  google.sheets = () => ({spreadsheets:{
    get: async options => options.includeGridData ? {data:{sheets:[]}} :
      {data:{sheets:[{properties:{sheetId:7,title:'Adatok'}}]}},
    batchUpdate: async options => {sheetUpdate = options.requestBody.requests[0].updateCells; return {data:{}};},
    values:{get:async () => ({data:{values:[row]}})}
  }});
  google.drive = () => ({files:{
    get: async options => ({data:{id:options.fileId,parents:['parent-id']}}),
    list: async () => ({data:{files:[]}}),
    create: async options => {
      created.push(options.requestBody);
      return {data:{id:'new-folder-id',name:options.requestBody.name,
        mimeType:options.requestBody.mimeType,parents:options.requestBody.parents}};
    }
  }});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'folder-test',sheetName:'Adatok',templateRootFolderId:'template-id'});
    const folder = await client.ensureProjectFolder('ABC123');
    assert.equal(folder.name, 'Pécs Fő utca 1');
    assert.equal(created.length, 8);
    assert.deepEqual(created[0].parents, ['parent-id']);
    assert.equal(sheetUpdate.start.rowIndex, 1);
    assert.equal(sheetUpdate.start.columnIndex, 4);
    assert.equal(sheetUpdate.rows[0].values[0].textFormatRuns[0].format.link.uri,
      'https://drive.google.com/drive/folders/new-folder-id');
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});

test('Azonos című és napi ajánlatkérések külön, dátumos mappát kapnak',async()=>{
  const originalSheets=google.sheets,originalDrive=google.drive;
  const row=Array(40).fill('');
  row[0]='SECOND123';row[1]='2026-10-13T10:00:00.000Z';row[2]='AJÁNLATKÉRÉS';
  row[33]='Pécs';row[34]='Fő utca';row[36]='1';
  const existing={id:'other-project-folder',name:'Pécs Fő utca 1 20261013',
    mimeType:'application/vnd.google-apps.folder',parents:['inquiry-parent'],
    appProperties:{projectUid:'FIRST123'}};
  const created=[];
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[]}}:
      {data:{sheets:[{properties:{sheetId:7,title:'Adatok'}}]}},
    batchUpdate:async()=>({data:{}}),
    values:{get:async()=>({data:{values:[row]}})}
  }});
  google.drive=()=>({files:{
    get:async options=>({data:{id:options.fileId,parents:['inquiry-parent']}}),
    list:async options=>({data:{files:options.q.includes("'inquiry-parent' in parents")?[existing]:[]}}),
    create:async options=>{created.push(options.requestBody);
      return {data:{id:'new-'+created.length,...options.requestBody}};}
  }});
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'inquiry-date-folder-test',sheetName:'Adatok',
      templateRootFolderId:'inquiry-template-test'});
    const folder=await client.ensureProjectFolder('SECOND123');
    assert.equal(folder.name,'Pécs Fő utca 1 20261013#2');
    assert.equal(created[0].appProperties.projectUid,'SECOND123');
    assert.equal(created[0].parents[0],'inquiry-parent');
  }finally{google.sheets=originalSheets;google.drive=originalDrive;}
});
