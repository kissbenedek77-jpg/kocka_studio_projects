'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');

test('Projektindítás PDF-et készít, FINAL indexet ír és a mappát mozgatja',async()=>{
  const originals=[google.sheets,google.drive,google.docs];
  const row=Array(65).fill('');row[0]='ABC123';row[2]='ELŐKÉSZÍTÉS';
  row[7]='Kiss';row[8]='Anna';row[33]='Magyaratád';row[38]='Magyaratád 531';
  const records=[['ABC123','ajanlat','offer-doc','DRAFT','']];
  const timelineRows=[];
  const parents={'project-root':'prep-root','template-root':'prep-root',
    'prep-root':'started-root','folder-0':'project-root','folder-1':'project-root',
    'folder-2':'project-root','folder-3':'project-root','folder-4':'project-root',
    'folder-5':'project-root','folder-6':'project-root','project-sheet':'folder-0',
    'offer-doc':'folder-1'};
  const names={'project-root':'Projekt A','template-root':'Template',
    'prep-root':'_Ajánlatok','started-root':'Projektek','project-sheet':'Tervezési adatok - Próba',
    'offer-doc':'Ajánlat - Próba'};
  const subfolders=['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  subfolders.forEach((name,i)=>{names['folder-'+i]=name;});
  let pdfCreated=0,finalMarked=false,moved=false;
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/project-root'}]}]}]}]}}:
      {data:{sheets:[{properties:{sheetId:1,title:'Adatok'}},
        {properties:{title:'_DokumentumIndex'}},
        {properties:{title:'_ProjektIdővonal'}},
        {properties:{title:'Műszaki leírás'}}]}},
    values:{
      get:async options=>({data:{values:options.range.includes('Adatok')&&
        !options.range.includes('AO1')?[row]:options.range.includes('_DokumentumIndex')?records:[]}}),
      batchGet:async options=>({data:{valueRanges:options.ranges.map(range=>({values:
        range.includes('_DokumentumIndex')?records:
        range.includes('_ProjektIdővonal')?timelineRows:[] }))}}),
      update:async options=>{if(options.range.includes('!C2'))row[2]=options.requestBody.values[0][0];
        return {data:{}};},
      batchUpdate:async options=>{if(options.requestBody.data?.some(item=>
        item.range.includes('_DokumentumIndex')))finalMarked=true;return {data:{}};},
      append:async options=>{if(options.range.includes('_DokumentumIndex'))
        records.push(...options.requestBody.values);
        if(options.range.includes('_ProjektIdővonal'))timelineRows.push(...options.requestBody.values);
        return {data:{}};}}
  }});
  google.drive=()=>({files:{
    get:async options=>({data:{id:options.fileId,name:names[options.fileId]||'Dokumentum',
      mimeType:options.fileId==='offer-doc'?'application/vnd.google-apps.document':
        options.fileId==='project-sheet'?'application/vnd.google-apps.spreadsheet':
          'application/vnd.google-apps.folder',
      parents:parents[options.fileId]?[parents[options.fileId]]:[]}}),
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      const files=Object.keys(parents).filter(id=>parents[id]===parent).map(id=>({
        id,name:names[id],mimeType:id==='project-sheet'?'application/vnd.google-apps.spreadsheet':
          id==='offer-doc'?'application/vnd.google-apps.document':
            'application/vnd.google-apps.folder'}));
      return {data:{files}};},
    copy:async options=>{const id='generated-'+options.fileId;
      names[id]=options.requestBody.name;parents[id]=options.requestBody.parents[0];
      return {data:{id}};},
    create:async options=>{if(options.requestBody.mimeType==='application/pdf')pdfCreated++;
      return {data:{id:'created-pdf'}};},
    export:async()=>({data:Buffer.from('%PDF-test')}),
    update:async options=>{if(options.addParents){parents[options.fileId]=options.addParents;
      moved=true;}return {data:{}};}
  }});
  google.docs=()=>({documents:{get:async()=>({data:{revisionId:'r1',body:{content:[]},
    namedRanges:{}}}),batchUpdate:async()=>({data:{}})}});
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'lifecycle-main',sheetName:'Adatok',templateRootFolderId:'template-root',
      pdfQuality:{convertPdfA:async bytes=>bytes}});
    await assert.rejects(client.startProject('ABC123','start:ABC123','2099-01-01'),/jövőbeli/);
    assert.equal(moved,false);
    const result=await client.startProject('ABC123','start:ABC123','2020-01-01');
    assert.equal(pdfCreated,1);
    assert.equal(finalMarked,true);
    assert.equal(moved,true);
    assert.equal(parents['project-root'],'started-root');
    assert.equal(row[2],'AKTÍV');
    assert.equal(result.project.stage,'started');
    assert.equal(timelineRows[0][2],'2020-01-01T12:00:00.000Z');
    assert.equal(result.project.contractDate,'2020-01-01T12:00:00.000Z');
  }finally{[google.sheets,google.drive,google.docs]=originals;}
});
