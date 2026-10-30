'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');
const {renderPackageOrder,latestRenderCoverFile,coverImageObject,
  publicImageUrl,coverImageRequest} = require('../server/cover_image.cjs');

test('A legfrissebb rendercsomag 1. számú képe kiválasztódik', () => {
  const files = [
    {id:'a1', name:'a_1 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T12:00:00Z'},
    {id:'b1', name:'b_1 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T11:00:00Z'},
    {id:'b2', name:'b_2 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T13:00:00Z'},
    {id:'lsf', name:'b11.lsf', mimeType:'video/x-la-asf', modifiedTime:'2026-09-28T12:00:00Z'},
    {id:'c1', name:'c_1 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T12:00:00Z'},
    {id:'d1', name:'d_1 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T12:00:00Z'},
    {id:'d2', name:'d_2 - Photo.jpg', mimeType:'image/jpeg', modifiedTime:'2026-09-28T12:00:00Z'}
  ];
  assert.equal(latestRenderCoverFile(files).id, 'd1');
  assert.equal(renderPackageOrder('a'), 1);
  assert.equal(renderPackageOrder('b'), 2);
  assert.equal(renderPackageOrder('d'), 4);
});

test('Kép nélkül nincs címlap, a legfrissebb csomag legkisebb sorszámú képe nyer', () => {
  assert.equal(latestRenderCoverFile([{id:'n', name:'notes.txt', mimeType:'text/plain'}]), null);
  assert.equal(latestRenderCoverFile([]), null);
  // A csoporton belül a legkisebb sorszám a címlapkép, akkor is, ha az 1-es
  // hiányzik; ilyenkor nem hibázik el a generálás.
  assert.equal(latestRenderCoverFile([
    {id:'a', name:'a_1 - Photo.jpg', mimeType:'image/jpeg'},
    {id:'b2', name:'b_2 - Photo.jpg', mimeType:'image/jpeg'},
    {id:'b3', name:'b_3 - Photo.jpg', mimeType:'image/jpeg'}
  ]).id, 'b2');
  // A betűjel nélküli vagy más típusú fájl nem címlapkép.
  assert.equal(latestRenderCoverFile([{id:'v', name:'b1.lsf', mimeType:'video/x-la-asf'}]), null);
});

test('A címlap a legnagyobb elhelyezett képobjektum', () => {
  const document = {positionedObjects:{
    'kix.logo':{objectId:'kix.logo',positionedObjectProperties:{embeddedObject:{
      size:{width:{magnitude:100,unit:'PT'},height:{magnitude:50,unit:'PT'}},
      imageProperties:{contentUri:'logo'}}}},
    'kix.cover':{objectId:'kix.cover',positionedObjectProperties:{embeddedObject:{
      size:{width:{magnitude:808,unit:'PT'},height:{magnitude:454,unit:'PT'}},
      imageProperties:{contentUri:'cover'}}}}
  }};
  assert.deepEqual(coverImageObject(document),
    {objectId:'kix.cover', width:808, height:454, area:808 * 454});
  assert.deepEqual(coverImageRequest('kix.cover', 'https://x'),
    {replaceImage:{imageObjectId:'kix.cover', uri:'https://x', imageReplaceMethod:'CENTER_CROP'}});
  assert.equal(publicImageUrl('img d1'), 'https://drive.google.com/uc?export=download&id=img%20d1');
  assert.throws(() => coverImageObject({positionedObjects:{}}),
    /nincs lecserélhető elhelyezett kép/);
});


test('A műszaki DRAFT címlapképe a legfrissebb Render képből cserélődik', async () => {
  const originals = [google.sheets,google.drive,google.docs];
  const row = Array(65).fill(''); row[0] = 'ABC123'; row[4] = 'Projekt mappa';
  row[7] = 'Kiss'; row[8] = 'Anna'; row[33] = 'Magyaratád'; row[38] = 'Magyaratád 531';
  const sheetRows = Array.from({length:20},() => Array(10).fill(''));
  sheetRows[1][1] = 'Lke-8'; sheetRows[1][4] = '1000'; sheetRows[1][7] = '200'; sheetRows[1][9] = '20%';
  const program = Array.from({length:16},(_,i) => {
    const letter = String.fromCharCode(97 + i); return [letter,`${letter}) Kitöltött program.`];});
  const folders = ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
  const docWrites = [];
  let created = null, removed = null;
  google.sheets = () => ({spreadsheets:{
    get:async options => {
      if (options.includeGridData) return {data:{sheets:[{data:[{startRow:1,
        rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/technical-root'}]}]}]}]}};
      return {data:{sheets:[{properties:{title:'_DokumentumIndex'}},
        {properties:{title:'Műszaki leírás'}},{properties:{title:'Generálás'}}]}};
    },
    values:{
      get:async options => ({data:{values:options.range.includes('Adatok') &&
        !options.range.includes('AO1') ? [row] : []}}),
      batchGet:async () => ({data:{valueRanges:[{values:sheetRows},{values:program},
        {values:[['TERV_TARGYA','Lakóépület bővítése']]},{values:[['Helyiség','Terület (m²)']]}]}}),
      update:async () => ({data:{}}),
      append:async () => ({data:{}})
    }
  }});
  google.drive = () => ({
    files:{
      get:async options => ({data:{id:options.fileId,name:'Projekt',
        mimeType:'application/vnd.google-apps.folder',parents:['started-root']}}),
      list:async options => {
        const match=options.q.match(/'([^']+)' in parents/);
        const parent=match ? match[1] : '';
        let files=[];
        if (parent === 'technical-root') files=folders.map((name,index) => ({
          id:'folder-'+index,name,mimeType:'application/vnd.google-apps.folder'}));
        if (parent === 'folder-0') files=[{id:'project-sheet',
          name:'Tervezési adatok - próba',mimeType:'application/vnd.google-apps.spreadsheet'}];
        if (parent === 'folder-6') files=[
          {id:'img-a1',name:'a_1 - Photo.jpg',mimeType:'image/jpeg',modifiedTime:'2026-09-28T09:00:00Z'},
          {id:'img-d2',name:'d_2 - Photo.jpg',mimeType:'image/jpeg',modifiedTime:'2026-09-28T09:00:00Z'},
          {id:'img-d1',name:'d_1 - Photo.jpg',mimeType:'image/jpeg',modifiedTime:'2026-09-28T09:00:00Z'}
        ];
        return {data:{files}};
      },
      copy:async () => ({data:{id:'generated-technical-doc'}})
    },
    permissions:{
      create:async options => {created=options;return {data:{id:'perm-1'}};},
      delete:async options => {removed=options;return {data:{}};}
    }
  });

  const body = {content:[{paragraph:{elements:[{startIndex:1,textRun:{
    content:'{{TERV_TARGYA}} {{HELYISEGLISTA}} {{TERVEZESI_ADATOK:Munkalap1!B2}}\n'}}]}}]};
  const positionedObjects={'kix.cover':{
    objectId:'kix.cover',positionedObjectProperties:{embeddedObject:{
      size:{width:{magnitude:808,unit:'PT'},height:{magnitude:454,unit:'PT'}},
      imageProperties:{contentUri:'cover'}
    }}
  }};
  google.docs = () => ({documents:{
    get:async () => ({data:{revisionId:'r1',body,namedRanges:{},positionedObjects}}),
    batchUpdate:async options => {docWrites.push(options);return {data:{}};}
  }});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'technical-cover',sheetName:'Adatok'});
    await client.ensureDocument('ABC123','muszakiLeiras');
    const cover = docWrites.map(item => item.requestBody.requests[0].replaceImage).find(Boolean);
    assert.ok(cover, 'a replaceImage kérés elmaradt');
    assert.equal(cover.imageObjectId, 'kix.cover');
    assert.equal(cover.uri, 'https://drive.google.com/uc?export=download&id=img-d1');
    assert.equal(created.fileId, 'img-d1');
    assert.deepEqual(created.requestBody, {role:'reader',type:'anyone'});
    assert.equal(removed.fileId, 'img-d1');
    assert.equal(removed.permissionId, 'perm-1');
  } finally {
    [google.sheets,google.drive,google.docs] = originals;
  }
});


