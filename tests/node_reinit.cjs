'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');
const {googleQuota}=require('../server/quota.cjs');

googleQuota.run=(kind,cost,call)=>call();

// A DRAFT újrainicializálás tesztje: a Google-hívások mockoltak, a teszt nem
// érhet el élő végpontot. A folyamat a piszkozatot a kukába teszi, törli az
// indexsorát, majd a friss sablonból újra létrehozza.
function mockReinit({status='ELŐKÉSZÍTÉS'}={}) {
  const originals=[google.sheets,google.drive,google.docs];
  const book='reinit-main-'+(mockReinit.counter=(mockReinit.counter||0)+1);
  const row=Array(65).fill('');row[0]='ABC123';row[2]=status;
  row[7]='Kiss';row[8]='Anna';row[9]='anna@example.com';
  row[33]='Magyaratád';row[38]='Magyaratád 531';
  const state={records:[['ABC123','ajanlat','offer-doc','DRAFT',''],
    ['ABC123','szerzodes','contract-doc','FINAL','']],
    trashed:[],deletedRows:[],copies:[],docWrites:[],fieldWrites:[],cleared:[],
    fieldRows:[['TERV_TARGYA','régi terv tárgya','súgó'],
      ['EPITES_JELLEGE','','súgó'],['HELYISEGLISTA','régi lista','súgó']]};
  const parents={'project-root':'prep-root','template-root':'prep-root',
    'folder-0':'project-root','folder-1':'project-root','offer-doc':'folder-1',
    'contract-doc':'folder-1','project-sheet':'folder-0'};
  const names={'project-root':'Projekt A','prep-root':'_Ajánlatok','folder-0':'írásos',
    'folder-1':'_Belső','project-sheet':'Tervezési adatok - Projekt A',
    'offer-doc':'Ajánlat - Próba','contract-doc':'Építész szerződés - Próba'};
  const spreadsheet=id=>id==='project-sheet'?'application/vnd.google-apps.spreadsheet':
    id.endsWith('-doc')?'application/vnd.google-apps.document':'application/vnd.google-apps.folder';
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/project-root'}]}]}]}]}}:
      {data:{sheets:[{properties:{sheetId:1,title:'Adatok'}},
        {properties:{sheetId:2,title:'_DokumentumIndex'}},
        {properties:{title:'Műszaki leírás'}}]}},
    values:{
      get:async options=>({data:{values:options.range.includes('Műszaki leírás')?
        state.fieldRows:options.range.includes('Adatok')&&
        !options.range.includes('AO1')?[row]:options.range.includes('_DokumentumIndex')?
          state.records:[]}}),
      batchGet:async options=>({data:{valueRanges:options.ranges.map(range=>({values:
        range.includes('_DokumentumIndex')?state.records:[]}))}}),
      update:async()=>({data:{}}),
      batchUpdate:async options=>{
        for(const item of options.requestBody.data || []) state.fieldWrites.push(item);
        return {data:{}};
      },
      clear:async options=>{state.cleared.push(options.range);return {data:{}};},
      append:async options=>{
        if(options.range.includes('_DokumentumIndex'))
          state.records.push(...options.requestBody.values);
        if(options.range.includes('Műszaki leírás'))
          state.fieldRows.push(...options.requestBody.values);
        return {data:{}};
      }
    },
    batchUpdate:async options=>{
      for(const item of options.requestBody.data || []) state.docWrites.push(item);
      for(const request of options.requestBody.requests || [])
        if(request.deleteDimension){const range=request.deleteDimension.range;
          state.deletedRows.push(range);
          state.records.splice(range.startIndex-1,range.endIndex-range.startIndex);}
      return {data:{}};
    }
  }});
  google.drive=()=>({files:{
    get:async options=>({data:{id:options.fileId,name:names[options.fileId]||'Dokumentum',
      mimeType:spreadsheet(options.fileId),
      parents:parents[options.fileId]?[parents[options.fileId]]:[]}}),
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      const files=Object.keys(parents).filter(id=>parents[id]===parent &&
        !state.trashed.includes(id)).map(id=>({id,name:names[id],
          mimeType:spreadsheet(id)}));
      return {data:{files}};},
    copy:async options=>{const id='copy-'+options.fileId+'-'+(state.copies.length+1);
      names[id]=options.requestBody.name;parents[id]=options.requestBody.parents[0];
      state.copies.push(id);return {data:{id}};},
    create:async options=>{const id='created-'+(state.copies.length+1);
      names[id]=options.requestBody.name;parents[id]=options.requestBody.parents?.[0];
      return {data:{id,name:names[id]}};},
    update:async options=>{
      if(options.requestBody?.trashed)state.trashed.push(options.fileId);
      return {data:{}};
    }
  }});
  google.docs=()=>({documents:{
    get:async()=>({data:{revisionId:'r1',body:{content:[]},namedRanges:{}}}),
    batchUpdate:async()=>({data:{}})
  }});
  const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
    sheetId:book,sheetName:'Adatok',templateRootFolderId:'template-root',
    pdfQuality:{convertPdfA:async bytes=>bytes}});
  return {client,state,row,restore:()=>{[google.sheets,google.drive,google.docs]=originals;}};
}

test('A DRAFT újrainicializálás kukázza, törli és újra létrehozza a piszkozatot',async()=>{
  const mock=mockReinit();
  try{
    const result=await mock.client.reinitializeDraftDocuments('ABC123','reinit:ABC123');
    assert.deepEqual(mock.state.trashed,['offer-doc']);
    assert.equal(mock.state.deletedRows.length,1);
    assert.equal(mock.state.deletedRows[0].startIndex,1);
    assert.equal(mock.state.deletedRows[0].endIndex,2);
    assert.equal(mock.state.copies.length,1);
    assert.match(result.message,/újra létrehozva/);
    assert.equal(result.project.stage,'preparation');
  }finally{mock.restore();}
});

test('A DRAFT újrainicializálás megerősítés nélkül nem nyúl a fájlokhoz',async()=>{
  const mock=mockReinit();
  try{
    await assert.rejects(mock.client.reinitializeDraftDocuments('ABC123',''),/megerősítése/);
    assert.deepEqual(mock.state.trashed,[]);
    assert.deepEqual(mock.state.deletedRows,[]);
  }finally{mock.restore();}
});

test('Lezárt projekt DRAFT fájljai nem inicializálhatók újra',async()=>{
  const mock=mockReinit({status:'KÉSZ'});
  try{
    await assert.rejects(mock.client.reinitializeDraftDocuments('ABC123','reinit:ABC123'),
      /Lezárt|lezárt/);
    assert.deepEqual(mock.state.trashed,[]);
  }finally{mock.restore();}
});

test('A műszaki leírás mentett tartalma teljesen kiürül',async()=>{
  const mock=mockReinit();
  try{
    const ok=await mock.client.resetTechnicalContent('ABC123');
    assert.equal(ok,true);
    // A program és a helyiséglista-táblázat teljes tartománya törlődik.
    assert.deepEqual(mock.state.cleared,
      ["'Tervezési program'!B2:B17",'Munkalap2!A2:B500']);
    // A fejezetmezők minden sora üres értéket kap (a fejléc nem).
    assert.equal(mock.state.fieldWrites.length,mock.state.fieldRows.length);
    assert.ok(mock.state.fieldWrites.every(item =>
      /^'Műszaki leírás'!B\d+$/.test(item.range) && item.values[0][0]===''));
    assert.ok(mock.state.fieldWrites.every(item => item.range!==`'Műszaki leírás'!B1`));
  }finally{mock.restore();}
});
