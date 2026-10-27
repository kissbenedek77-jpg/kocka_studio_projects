'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');
const {draftInputs,draftPrompt,parseDraftResult}=require('../server/technical_ai.cjs');

test('Műszaki AI csak tényszerű prózamezőkből készít ellenőrizhető tervezetet',()=>{
  const notes=draftInputs({'HELYSZIN:meglevo_allapot':'Üres telek, nincs épület.',
    'OVEZET:ellenorzes_allapota':'Ellenőrizve'});
  assert.deepEqual(Object.keys(notes),['HELYSZIN:meglevo_allapot']);
  const prompt=draftPrompt({notes,sheetValues:{'TERVEZESI_ADATOK:Munkalap1!E2':'1120',
    'TERVEZESI_ADATOK:Munkalap1!B3':'25% szezonális'},projectType:'Lakóház'});
  assert.match(prompt,/Ne találj ki anyagot/);
  assert.match(prompt,/1120/);
  assert.doesNotMatch(prompt,/szezonális/);
  assert.throws(()=>draftInputs({'OVEZET:forras_url':'https://example.com'}),/legalább egy/);
  assert.deepEqual(parseDraftResult({candidates:[{content:{parts:[{text:JSON.stringify({
    sections:[{key:'HELYSZIN:meglevo_allapot',text:'A telken jelenleg nem áll épület.'}]
  })}]}}]},notes),{'HELYSZIN:meglevo_allapot':'A telken jelenleg nem áll épület.'});
  assert.throws(()=>parseDraftResult({candidates:[{content:{parts:[{text:JSON.stringify({
    sections:[{key:'OVEZET:forras_url',text:'Kitalált HÉSZ.'}]
  })}]}}]},notes),/érvénytelen/);
});

test('Műszaki AI a projektadatlapból dolgozik, a tervezetet nem menti automatikusan',async()=>{
  const old={sheets:google.sheets,drive:google.drive,fetch:global.fetch,
    key:process.env.GEMINI_API_KEY,model:process.env.GEMINI_TECHNICAL_MODEL};
  const row=Array(40).fill('');row[0]='ABC123';row[4]='Projekt mappa';row[8]='Lakóház';
  const readRanges=[],requests=[];
  google.sheets=()=>({spreadsheets:{get:async options=>options.includeGridData?
    {data:{sheets:[{data:[{startRow:1,rowData:[{values:[{
      hyperlink:'https://drive.google.com/drive/folders/technical-ai-root'}]}]}]}]}}:
    {data:{sheets:[{properties:{title:'Műszaki leírás'}}]}},
    values:{get:async options=>{readRanges.push(options.range);return {data:{values:
      options.range.includes('Adatok')?[row]:options.range.includes('Munkalap1')?
        Array.from({length:20},()=>Array(10).fill('1')):[]}};}}}});
  google.drive=()=>({files:{get:async options=>({data:{id:options.fileId,
    name:'Projekt',parents:['started-root']}}),
    list:async options=>{const parent=options.q.match(/'([^']+)' in parents/)?.[1];
      return {data:{files:parent==='technical-ai-root'?
        ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render']
          .map((name,index)=>({id:index?'sub-'+index:'written',name,
            mimeType:'application/vnd.google-apps.folder'})):
        parent==='written'?[{id:'ai-sheet',name:'Tervezési adatok - Próba',
          mimeType:'application/vnd.google-apps.spreadsheet'}]:[]}};}}});
  process.env.GEMINI_API_KEY='test-key';process.env.GEMINI_TECHNICAL_MODEL='gemini-2.5-flash';
  global.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({
      sections:[{key:'HELYSZIN:meglevo_allapot',text:'A telek jelenleg beépítetlen.'}]
    })}]}}]})};};
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-ai-main',sheetName:'Adatok'});
    const result=await client.draftTechnicalText('ABC123',{
      'HELYSZIN:meglevo_allapot':'Beépítetlen telek.',
      'OVEZET:forras_url':'https://example.com'});
    assert.equal(result.sections['HELYSZIN:meglevo_allapot'],'A telek jelenleg beépítetlen.');
    assert.equal(requests.length,1);
    assert.equal(readRanges.some(range=>range.includes('Munkalap1')),true);
    assert.equal(JSON.stringify(requests[0].body).includes('OVEZET:forras_url'),false);
    assert.equal(requests[0].body.generationConfig.responseMimeType,'application/json');
  }finally{
    google.sheets=old.sheets;google.drive=old.drive;global.fetch=old.fetch;
    if(old.key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old.key;
    if(old.model===undefined)delete process.env.GEMINI_TECHNICAL_MODEL;
    else process.env.GEMINI_TECHNICAL_MODEL=old.model;
  }
});
