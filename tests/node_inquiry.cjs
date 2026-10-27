'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');
const {validateInquiry,inquiryPhotos,photoType}=require('../server/inquiry.cjs');
const {FIELDS}=require('../server/domain.cjs');
const {createTrackingCredential}=require('../server/tracking_credential.cjs');

function form(values){const result=new FormData();for(const [key,value] of Object.entries(values))result.set(key,value);return result}
const sample={firstName:'Anna',lastName:'Kiss',email:'anna@example.com',phone:'+36 20 123 4567',
  projectType:'Új építés',city:'Magyaratád',street:'Fő utca',houseNumber:'12',
  parcelNumber:'531',description:'Új családi házat szeretnék.\nHelyszíni fotókkal.',privacy:'yes'};

test('Az ajánlatkérő az adatbekérő teljes adatkezelési tájékoztatóját mutatja',()=>{
  const client=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const inquiry=fs.readFileSync(path.join(__dirname,'..','public','inquiry.html'),'utf8');
  const notice=html=>{const start=html.indexOf('  <div id="privacyModal"');return html.slice(start,html.indexOf('<script',start)).replace(/\r\n/g,'\n').trim()};
  assert.equal(notice(inquiry),notice(client));
  assert.match(inquiry,/name="privacy" type="checkbox" value="yes" required/);
  assert.match(inquiry,/id="gdprOpenLink"/);
});

test('Az ajánlatkérés alapadatai és a cím vagy helyrajzi szám ellenőrzöttek',()=>{
  assert.equal(validateInquiry(form(sample)).email,'anna@example.com');
  assert.equal(validateInquiry(form({...sample,street:'',houseNumber:''})).parcelNumber,'531');
  assert.throws(()=>validateInquiry(form({...sample,street:'',houseNumber:'',parcelNumber:''})),/helyrajzi/);
  assert.throws(()=>validateInquiry(form({...sample,privacy:'no'})),/adatkezelési/);
  assert.throws(()=>validateInquiry(form({...sample,email:'hibás'})),/e-mail/);
  assert.equal(validateInquiry(form({...sample,projectType:'Egyéb',projectTypeOther:'Tájépítészeti terv'})).projectType,
    'Egyéb: Tájépítészeti terv');
  assert.throws(()=>validateInquiry(form({...sample,projectType:'Egyéb'})),/projectTypeOther/);
  assert.throws(()=>validateInquiry(form({...sample,projectType:'ismeretlen'})),/projekt típust/);
});

test('Csak valódi képtartalom kerülhet a fotófeltöltésbe',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,1,2]);
  const input=form(sample);input.append('photos',new Blob([jpeg],{type:'image/jpeg'}),'helyszin.jpg');
  const photos=await inquiryPhotos(input);
  assert.equal(photos.length,1);assert.equal(photos[0].extension,'jpg');
  assert.equal(photoType(Buffer.from('not-an-image')),null);
  const invalid=form(sample);invalid.append('photos',new Blob(['fake'],{type:'image/jpeg'}),'hamis.jpg');
  await assert.rejects(inquiryPhotos(invalid),/JPEG, PNG, WebP vagy HEIC/);
  const tooLarge=form(sample);
  for(let index=0;index<3;index++)tooLarge.append('photos',
    new Blob([Buffer.alloc(6*1024*1024)],{type:'image/jpeg'}),`nagy-${index}.jpg`);
  await assert.rejects(inquiryPhotos(tooLarge),/összesen legfeljebb 16 MB/);
});

test('A nyilvános ajánlatkérés projektet, alapfájlokat és fotómappát készít',async()=>{
  const oldSheets=google.sheets,oldDrive=google.drive;
  const rows=[],files=new Map(),writes=[];let index=0,folderUrl='',submissionTab=false,submissionRow;
  files.set('template-root-0001',{id:'template-root-0001',name:'_Template',
    mimeType:'application/vnd.google-apps.folder',parents:['parent-root-0001']});
  files.set('parent-root-0001',{id:'parent-root-0001',name:'Projektek',
    mimeType:'application/vnd.google-apps.folder',parents:[]});
  const mainBook='inquiry-test-book';
  google.sheets=()=>({spreadsheets:{
    get:async opts=>opts.includeGridData?{data:{sheets:folderUrl?[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:folderUrl}]}]}]}]:[]}}:{data:{sheets:[
        {properties:{title:'Adatok',sheetId:1}},{properties:{title:'Generálás',sheetId:5}},
        ...(submissionTab?[{properties:{title:'_UgyfelBekuldesek',sheetId:9}}]:[])]}},
    batchUpdate:async opts=>{const request=opts.requestBody.requests[0];
      if(request.addSheet?.properties?.title==='_UgyfelBekuldesek')submissionTab=true;
      if(opts.spreadsheetId===mainBook&&request.updateCells){
        const cell=request.updateCells.rows[0].values[0];
        folderUrl=cell.textFormatRuns[0].format.link.uri;
      }return {data:{}}},
    values:{
      get:async opts=>({data:{values:opts.range.includes('_UgyfelBekuldesek')?
        (submissionRow?[submissionRow]:[]):opts.spreadsheetId===mainBook?rows:[]}}),
      append:async opts=>{if(opts.range.includes('_UgyfelBekuldesek'))
        submissionRow=opts.requestBody.values[0];else rows.push(opts.requestBody.values[0]);return {data:{}}},
      batchUpdate:async()=>({data:{}}),update:async()=>({data:{}})
    }
  }});
  google.drive=()=>({files:{
    get:async opts=>({data:opts.alt==='media'?Buffer.from([0xff,0xd8,0xff,0xe0]):files.get(opts.fileId)}),
    list:async opts=>{const parent=opts.q.match(/^'([^']+)' in parents/)?.[1];return {data:{files:
      [...files.values()].filter(file=>file.parents?.includes(parent))}}},
    create:async opts=>{
      const id='created-file-'+(++index).toString().padStart(5,'0');
      const file={id,...opts.requestBody,mimeType:opts.requestBody.mimeType||opts.media?.mimeType};
      files.set(id,file);writes.push({file,media:opts.media});return {data:file};
    },
    copy:async opts=>{
      const file={id:'copied-sheet-0001',name:opts.requestBody.name,
        parents:opts.requestBody.parents,mimeType:'application/vnd.google-apps.spreadsheet'};
      files.set(file.id,file);return {data:file};
    }
  }});
  try{
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://example.test',
      sheetId:mainBook,sheetName:'Adatok',templateRootFolderId:'template-root-0001',
      projectDataTemplateId:'source-sheet-0001'});
    const data=validateInquiry(form(sample));
    const result=await client.createInquiry(data,[{bytes:Buffer.from([0xff,0xd8,0xff,0xe0]),
      mime:'image/jpeg',extension:'jpg'}]);
    assert.equal(result.prepared,true);assert.equal(result.photoCount,1);
    assert.deepEqual(result.warnings,[]);
    const row=rows[0];
    assert.equal(row[FIELDS.indexOf('status')],'AJÁNLATKÉRÉS');
    assert.equal(row[FIELDS.indexOf('email')],'anna@example.com');
    assert.equal(row[FIELDS.indexOf('gdprAccepted')],true);
    assert.equal(row[58],sample.description);
    assert.equal(submissionRow[0],result.uid);
    assert.equal(submissionRow[2],'incomplete');
    assert.ok(folderUrl.includes('/folders/'));
    const projectFolder=[...files.values()].find(file=>
      file.mimeType==='application/vnd.google-apps.folder'&&
      file.parents?.includes('parent-root-0001')&&file.id!=='template-root-0001');
    const inquiryDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest',
      year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row[FIELDS.indexOf('createdAt')])).replace(/-/g,'');
    assert.ok(projectFolder.name.endsWith(' '+inquiryDate));
    assert.equal(projectFolder.appProperties.projectUid,result.uid);
    assert.ok([...files.values()].some(file=>file.name==='Kapott anyagok'));
    assert.ok([...files.values()].some(file=>file.name==='Helyszín-01.jpg'));
    assert.ok([...files.values()].some(file=>file.name==='Ajánlatkérés.txt'));
    assert.ok([...files.values()].some(file=>file.id==='copied-sheet-0001'));
    const image=writes.find(item=>item.file.name==='Helyszín-01.jpg');
    assert.equal(image.media.mimeType,'image/jpeg');
    const preview=await client.projectImage(result.uid,image.file.id);
    assert.equal(preview.mime,'image/jpeg');
    assert.deepEqual(preview.bytes,Buffer.from([0xff,0xd8,0xff,0xe0]));
    files.set('outside-image-0001',{id:'outside-image-0001',name:'Másik kép.jpg',
      mimeType:'image/jpeg',parents:['parent-root-0001']});
    await assert.rejects(client.projectImage(result.uid,'outside-image-0001'),/nem a projekt/);
  }finally{google.sheets=oldSheets;google.drive=oldDrive;}
});

test('A nyilvános végpont multipart űrlapot fogad, és Google-módosítás előtt ellenőriz',async()=>{
  const secret='i'.repeat(48),owner='owner@example.com';
  const child=spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:owner,SESSION_SECRET:secret,
      GOOGLE_TRACKING_CREDENTIAL:createTrackingCredential(secret,owner,'test-refresh-token')},
    stdio:['ignore','pipe','pipe']
  });
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('A szerver nem indult el.')),10000);
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('A szerver kilépett: '+code));});
    });
    const base=`http://127.0.0.1:${port}`,endpoint=base+'/api/inquiry';
    const invalid=await fetch(endpoint,{method:'POST',headers:{Origin:'http://127.0.0.1:3000',
      'X-Kocka-Inquiry':'1'},body:form({...sample,privacy:'no'})});
    assert.equal(invalid.status,400);
    assert.match((await invalid.json()).error,/adatkezelési/);
    const crossSite=await fetch(endpoint,{method:'POST',headers:{Origin:'https://example.test',
      'X-Kocka-Inquiry':'1'},body:form(sample)});
    assert.equal(crossSite.status,403);
    const bot=await fetch(endpoint,{method:'POST',headers:{Origin:'http://127.0.0.1:3000',
      'X-Kocka-Inquiry':'1'},body:form({...sample,website:'https://spam.example'})});
    assert.equal(bot.status,201);
    assert.equal((await bot.json()).uid,'BEÉRKEZETT');
  }finally{child.kill();}
});
