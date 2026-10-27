'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');
const {fieldSheetRows}=require('../server/technical_document.cjs');

test('Mobil műszaki űrlap a mező kulcsa alapján írja a projekt Sheetet',async()=>{
  const original=[google.sheets,google.drive];
  const row=Array(40).fill('');row[0]='ABC123';row[4]='Projekt mappa';
  const fields=fieldSheetRows().slice(1).map(item=>item.slice(0,2));
  const moved=fields.splice(0,1)[0];fields.push(moved);
  let write;
  google.sheets=()=>({spreadsheets:{get:async options=>options.includeGridData?
    {data:{sheets:[{data:[{startRow:1,rowData:[{values:[{
      hyperlink:'https://drive.google.com/drive/folders/technical-form-root'}]}]}]}]}}:
    {data:{sheets:[{properties:{title:'Műszaki leírás'}}]}},
    values:{get:async options=>({data:{values:options.range.includes('Adatok')?[row]:
      options.range.includes('Műszaki leírás')?fields:[]}}),
      batchUpdate:async options=>{write=options;return {data:{}};}}}});
  google.drive=()=>({files:{get:async options=>({data:{id:options.fileId,
    name:'Projekt',parents:['started-root']}}),
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      return {data:{files:parent==='technical-form-root'?
        ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render']
          .map((name,index)=>({id:index?'sub-'+index:'written',name,
            mimeType:'application/vnd.google-apps.folder'})):
        parent==='written'?[{id:'form-sheet',name:'Tervezési adatok - Próba',
          mimeType:'application/vnd.google-apps.spreadsheet'}]:[]}};}}});
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-form-main',sheetName:'Adatok'});
    await client.saveTechnicalFields('ABC123',{TERV_TARGYA:'Lakóépület bővítése'});
    assert.equal(write.requestBody.data.length,1);
    assert.equal(write.requestBody.data[0].range,"'Műszaki leírás'!B"+(fields.length+1));
    assert.equal(write.requestBody.data[0].values[0][0],'Lakóépület bővítése');
    await assert.rejects(client.saveTechnicalFields('ABC123',{HIBA:'x'}),/Ismeretlen/);
  }finally{[google.sheets,google.drive]=original;}
});
