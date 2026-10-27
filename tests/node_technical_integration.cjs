'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');

test('Node a műszaki DRAFT-ot projekt Sheetből és PLN fájlból készíti',async()=>{
  const originals=[google.sheets,google.drive,google.docs];
  const row=Array(65).fill(''); row[0]='ABC123'; row[4]='Projekt mappa';
  row[7]='Kiss'; row[8]='Anna'; row[33]='Magyaratád'; row[38]='Magyaratád 531';
  const sheetRows=Array.from({length:20},()=>Array(10).fill(''));
  sheetRows[1][1]='Lke-8';sheetRows[1][4]='1000';sheetRows[1][7]='200';sheetRows[1][9]='20%';
  const program=Array.from({length:16},(_,i)=>{const letter=String.fromCharCode(97+i);
    return [letter,`${letter}) Kitöltött program.`];});
  let docWrite,appended,areaWritten;
  const folders=['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/technical-root'}]}]}]}]}}:
      {data:{sheets:[{properties:{title:'_DokumentumIndex'}},
        {properties:{title:'Műszaki leírás'}},{properties:{title:'Generálás'}}]}},
    values:{get:async options=>({data:{values:options.range.includes('Adatok')&&
      !options.range.includes('AO1')?[row]:[]}}),
      batchGet:async()=>({data:{valueRanges:[{values:sheetRows},{values:program},
        {values:[['TERV_TARGYA','Lakóépület bővítése']]},{values:[['Helyiség','Terület (m²)']]}]}}),
      update:async options=>{if(options.range.includes('H7'))areaWritten=options;return {data:{}};},
      append:async options=>{appended=options;return {data:{}};}}
  }});
  google.drive=()=>({files:{
    get:async options=>options.alt==='media'?{data:Buffer.from([
      '| Helyiség szintjének neve | Helyiség neve | Mért terület',
      '1 | Földszint | nappali | 30,00'].join('\n'))}:
      {data:{id:options.fileId,name:'Projekt',mimeType:'application/vnd.google-apps.folder',
        parents:['started-root']}},
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      const files=parent==='technical-root'?folders.map((name,i)=>({id:'folder-'+i,name,
        mimeType:'application/vnd.google-apps.folder'})):
        parent==='folder-0'?[{id:'project-sheet',name:'Tervezési adatok - próba',
          mimeType:'application/vnd.google-apps.spreadsheet'}]:
        parent==='folder-2'?[{id:'plan-pdf',name:'EK-01 Helyszínrajz.pdf',mimeType:'application/pdf'}]:
        parent==='folder-5'?[{id:'room-text',name:'helyiségek.txt',mimeType:'text/plain'}]:[];
      return {data:{files}};},
    copy:async()=>({data:{id:'generated-technical-doc'}})
  }});
  const body={content:[{paragraph:{elements:[{startIndex:1,textRun:{
    content:'{{TERV_TARGYA}} {{HELYISEGLISTA}} {{TERVEZESI_ADATOK:Munkalap1!B2}}\n'}}]}}]};
  google.docs=()=>({documents:{get:async()=>({data:{revisionId:'r1',body,namedRanges:{}}}),
    batchUpdate:async options=>{docWrite=options;return {data:{}};}}});
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-main',sheetName:'Adatok'});
    const result=await client.ensureDocument('ABC123','muszakiLeiras');
    assert.equal(result.created,true);
    assert.equal(areaWritten.requestBody.values[0][0],30);
    const texts=docWrite.requestBody.requests.filter(item=>item.replaceNamedRangeContent)
      .map(item=>item.replaceNamedRangeContent.text);
    assert.ok(texts.includes('Lakóépület bővítése'));
    assert.ok(texts.some(text=>text.includes('nappali\t30,00 m²')));
    assert.deepEqual(appended.requestBody.values[0].slice(0,4),
      ['ABC123','muszakiLeiras','generated-technical-doc','DRAFT']);
  }finally{[google.sheets,google.drive,google.docs]=originals;}
});
