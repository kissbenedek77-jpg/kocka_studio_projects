'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Ellenőrzési válasz a meglévő UID-hez kerül, hang csak a projekt mappájába tölthető', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const originalDocs = google.docs;
  const rootId = 'projectfolder123456', parentId = 'parentfolder123456';
  const row = Array(65).fill('');
  row[0] = 'ABC123'; row[2] = 'ELŐKÉSZÍTÉS'; row[4] = `https://drive.google.com/drive/folders/${rootId}`;
  let checkTab = false;
  const answers = [];
  const uploads = [];
  google.sheets = () => ({spreadsheets:{
    get: async options => options.includeGridData ? {data:{sheets:[]}} :
      {data:{sheets:checkTab ? [{properties:{title:'_ProjektEllenőrzés'}}] : []}},
    batchUpdate: async () => {checkTab = true; return {data:{}};},
    values:{
      get: async options => ({data:{values:options.range.includes('Adatok') ? [row] : []}}),
      batchGet: async options => ({data:{valueRanges:options.ranges.map(range => ({
        values:range.includes('_ProjektEllenőrzés') ? answers : []}))}}),
      update: async () => ({data:{}}),
      append: async options => {answers.push(options.requestBody.values[0]); return {data:{}};}
    }
  }});
  google.drive = () => ({files:{
    get: async options => ({data:options.fileId === rootId ?
      {id:rootId,name:'Projekt',mimeType:'application/vnd.google-apps.folder',parents:[parentId]} :
      {id:parentId,name:'_Lezárt',mimeType:'application/vnd.google-apps.folder',parents:[]}}),
    list: async options => ({data:{files:options.q.includes(`'${rootId}'`) ?
      ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'].map((name,index) =>
        ({id:index === 1 ? 'internalfolder123' : 'folder'+index+'123456789',name,
          mimeType:'application/vnd.google-apps.folder'})) :
      options.q.includes("'internalfolder123'") ?
        [{id:'audiofolder12345',name:'Hangjegyzetek',mimeType:'application/vnd.google-apps.folder'}] : []}}),
    create: async options => {uploads.push(options); return {data:{id:'uploadedfile12345',
      webViewLink:'https://drive.google.com/file/d/uploadedfile12345/view'}};}
  }});
  google.docs = () => ({});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'node-checks-audio-test',sheetName:'Adatok'});
    const result = await client.answerCheck('ABC123','status_folder','Indoklás');
    assert.equal(result.issues.find(issue => issue.code === 'status_folder').answer,'Indoklás');
    assert.deepEqual(answers[0].slice(0,3),['ABC123','status_folder','Indoklás']);
    await assert.rejects(client.answerCheck('ABC123','folder','Nem'),/nem válaszolható/);
    await assert.rejects(client.uploadAudio('ABC123','x.txt','text/plain','YQ=='),/hangfájl/);
    const upload = await client.uploadAudio('ABC123','felvétel.mp3','audio/mpeg','YQ==');
    assert.equal(upload.id,'uploadedfile12345');
    assert.equal(uploads.length,1);
    assert.deepEqual(uploads[0].requestBody.parents,['audiofolder12345']);
    assert.equal(uploads[0].media.mimeType,'audio/mpeg');
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
    google.docs = originalDocs;
  }
});
