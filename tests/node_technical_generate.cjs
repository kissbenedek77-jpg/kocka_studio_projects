'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');
const {MANUAL_FIELDS}=require('../server/technical_document.cjs');
const {AUTO_CHAPTERS}=require('../server/technical_auto.cjs');

test('A műszaki leírás egy kéréssel, AI-val elkészül és a fejezetek mentődnek',async()=>{
  const originals=[google.sheets,google.drive,google.docs,global.fetch];
  const row=Array(65).fill(''); row[0]='ABC123'; row[4]='Projekt mappa';
  row[7]='Kiss'; row[8]='Anna'; row[9]='anna@example.com'; row[10]='+36-30/123-4567';
  row[33]='Magyaratád'; row[38]='Magyaratád 531';
  const sheetRows=Array.from({length:20},()=>Array(10).fill(''));
  sheetRows[1][1]='Lke-8';sheetRows[1][4]='1000';sheetRows[1][7]='200';sheetRows[1][9]='20%';
  const program=Array.from({length:16},(_,i)=>{const letter=String.fromCharCode(97+i);
    return [letter,`${letter}) Kitöltött program.`];});
  const fieldRows=MANUAL_FIELDS.map(([key,help])=>[key,'',help]);
  const roomRows=[['Helyiség','Terület (m²)'],['Földszint',''],['Nappali','30,00'],
    ['Földszint összesen','30,00'],['Teljes összesen','30,00']];
  const folders=['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  let fieldsWrite=null,docWrite=null,fetchBody=null;
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/generate-root'}]}]}]}]}}:
      {data:{sheets:[{properties:{title:'_DokumentumIndex'}},
        {properties:{title:'Műszaki leírás'}}]}},
    values:{
      get:async options=>({data:{values:options.range.includes('Adatok')&&
        !options.range.includes('AO1')?[row]:options.range.includes('Műszaki leírás')?
          fieldRows.map(item=>item.slice()):[]}}),
      batchGet:async()=>({data:{valueRanges:[{values:sheetRows},{values:program},
        {values:fieldRows},{values:roomRows}]}}),
      update:async()=>({data:{}}),
      batchUpdate:async options=>{
        fieldsWrite=options;
        for(const item of options.requestBody.data || []){
          const match=/!B(\d+)$/.exec(item.range);
          if(!match)continue;
          const index=Number(match[1])-2;
          if(fieldRows[index])fieldRows[index][1]=String(item.values?.[0]?.[0] ?? '');
        }
        return {data:{}};
      },
      append:async()=>({data:{}})
    }
  }});
  google.drive=()=>({files:{
    get:async options=>options.alt==='media'?{data:Buffer.from([
      '| Helyiség szintjének neve | Helyiség neve | Mért terület',
      '1 | Földszint | nappali | 30,00'].join('\n'))}:
      {data:{id:options.fileId,name:'Projekt',mimeType:'application/vnd.google-apps.folder',
        parents:['started-root']}},
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      const files=parent==='generate-root'?folders.map((name,i)=>({id:'folder-'+i,name,
        mimeType:'application/vnd.google-apps.folder'})):
        parent==='folder-0'?[{id:'project-sheet',name:'Tervezési adatok - próba',
          mimeType:'application/vnd.google-apps.spreadsheet'}]:
        parent==='folder-2'?[{id:'plan-pdf',name:'EK-01 Helyszínrajz.pdf',
          mimeType:'application/pdf',size:'1000'}]:
        parent==='folder-5'?[{id:'room-text',name:'helyiségek.txt',mimeType:'text/plain',
          size:'120'}]:[];
      return {data:{files}};},
    copy:async()=>({data:{id:'generated-technical-doc'}})
  }});
  const body={content:[{paragraph:{elements:[{startIndex:1,textRun:{
    content:'{{TERV_TARGYA}} {{HELYSZIN:meglevo_allapot}} {{HELYISEGLISTA}}\n'}}]}}]};
  google.docs=()=>({documents:{get:async()=>({data:{revisionId:'r1',body,namedRanges:{}}}),
    batchUpdate:async options=>{docWrite=options;return {data:{}};}}});
  process.env.GEMINI_API_KEY='test-key';process.env.GEMINI_TECHNICAL_MODEL='gemini-2.5-flash';
  global.fetch=async(url,options)=>{
    fetchBody=JSON.parse(options.body);
    const sections=AUTO_CHAPTERS.map(item=>({key:item.key,
      text:`${item.title}: a projekt adatai szerint készült szöveg.`}));
    return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[
      {text:JSON.stringify({sections})}]}}]})};
  };
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-generate-main',sheetName:'Adatok'});
    const result=await client.generateTechnicalDocument('ABC123');
    assert.equal(result.created,true);
    assert.equal(result.url,'https://docs.google.com/document/d/generated-technical-doc/edit');
    assert.equal(result.chapters.length,AUTO_CHAPTERS.length);
    assert.equal(result.chapters[0].value,
      `${AUTO_CHAPTERS[0].title}: a projekt adatai szerint készült szöveg.`);
    assert.equal(fieldsWrite.requestBody.data.length,AUTO_CHAPTERS.length);
    assert.ok(docWrite.requestBody.requests.some(item=>item.replaceNamedRangeContent));
    const prompt=JSON.stringify(fetchBody);
    assert.equal(prompt.includes('Kiss'),false,'Az ügyfél neve nem kerülhet az AI-hoz.');
    assert.equal(prompt.includes('anna@example.com'),false,'Az e-mail-cím nem kerülhet az AI-hoz.');
    assert.equal(prompt.includes('+36-30/123-4567'),false,'A telefonszám nem kerülhet az AI-hoz.');
    assert.ok(prompt.includes('1000'),'A tervezési adat kerüljön az AI elé.');
    assert.ok(prompt.includes('EK-01 Helyszínrajz'),'A tervlapok kerüljenek az AI elé.');
    assert.match(prompt,/KIEGÉSZÍTENDŐ/,'A hiányzó adat jelölésének szabálya hiányzik.');
  }finally{
    [google.sheets,google.drive,google.docs,global.fetch]=originals;
  }
});

test('Projektmappa nélkül az AI műszaki leírás nem indul el',async()=>{
  const originalSheets=google.sheets;
  const row=Array(40).fill(''); row[0]='ABC123';
  google.sheets=()=>({spreadsheets:{
    get:async options=>options.includeGridData?{data:{sheets:[]}}:
      {data:{sheets:[]}},
    values:{get:async()=>({data:{values:[row]}})}
  }});
  process.env.GEMINI_API_KEY='test-key';
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-generate-nofolder',sheetName:'Adatok'});
    await assert.rejects(client.generateTechnicalDocument('ABC123'),/projektmappát/);
  }finally{google.sheets=originalSheets;}
});
