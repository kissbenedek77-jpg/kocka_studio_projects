'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Node egyszerű Google Docs sablont másol, kitölt és dokumentumindexbe ír', async () => {
  const originals = [google.sheets,google.drive,google.docs];
  const row = Array(65).fill(''); row[0] = 'ABC123'; row[4] = 'Projekt mappa';
  row[7] = 'Kiss'; row[8] = 'Anna';
  let appended, docWrite, copied;
  const folderNames = ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  google.sheets = () => ({spreadsheets:{
    get:async options => options.includeGridData ? {data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/root-folder-id'}]}]}]}]}} :
      {data:{sheets:[{properties:{title:'_DokumentumIndex'}}]}},
    values:{
      get:async options => ({data:{values:options.range.includes('Adatok') && !options.range.includes('AO1') ?
        [row] : []}}),
      append:async options => {appended=options; return {data:{}};}
    }
  }});
  google.drive = () => ({files:{
    get:async options => ({data:{id:options.fileId,name:'Projekt',parents:['parent-id']}}),
    list:async options => ({data:{files:options.q.includes('root-folder-id') ?
      folderNames.map((name,index) => ({id:`sub-${index}`,name,
        mimeType:'application/vnd.google-apps.folder'})) : []}}),
    copy:async options => {copied=options; return {data:{id:'generated-doc-id'}};}
  }});
  google.docs = () => ({documents:{
    get:async () => ({data:{revisionId:'r1',body:{content:[{paragraph:{elements:[
      {startIndex:1,textRun:{content:'Név: {{Teljes név}}\n'}}]}}]},namedRanges:{}}}),
    batchUpdate:async options => {docWrite=options; return {data:{}};}
  }});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'document-happy-test',sheetName:'Adatok'});
    const result = await client.ensureDocument('ABC123','ajanlat');
    assert.equal(result.created,true);
    assert.equal(copied.requestBody.parents[0],'sub-1');
    assert.equal(docWrite.documentId,'generated-doc-id');
    assert.equal(docWrite.requestBody.requests[1].replaceNamedRangeContent.text,'Kiss Anna');
    assert.deepEqual(appended.requestBody.values[0].slice(0,4),
      ['ABC123','ajanlat','generated-doc-id','DRAFT']);
  } finally {
    [google.sheets,google.drive,google.docs] = originals;
  }
});
