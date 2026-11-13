'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {webSources} = require('../server/web_sources.cjs');

function projectDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'kocka-web-src-'));
  const data = path.join(dir,'shared','data');
  fs.mkdirSync(data,{recursive:true});
  for (const [name,text] of Object.entries(files))
    fs.writeFileSync(path.join(data,name),text,'utf8');
  return dir;
}

test('Helyi projektmappából olvassa a data fájlokat', async () => {
  const dir = projectDir({'rolunk.txt':'hero=RÓLUNK\n','projektek.txt':'[haz]\ntitle=Ház\n'});
  const sources = webSources({projectDir:dir,cacheMs:0});
  const result = await sources.load();
  assert.equal(result.source,'local');
  assert.deepEqual(result.files.map(file => file.file),['projektek.txt','rolunk.txt']);
  assert.match(result.files[1].text,/RÓLUNK/);
});

test('GitHub repóból olvassa a data fájlokat', async () => {
  const calls = [];
  const git = {
    status:()=>({configured:true}),
    listDataFiles:async dir => {calls.push(dir);
      return [{path:'shared/data/a.txt',name:'a.txt'},{path:'shared/data/b.txt',name:'b.txt'}]},
    readTextFile:async file => 'tartalom: '+file
  };
  const sources = webSources({git,projectDir:'',cacheMs:0});
  const result = await sources.load();
  assert.equal(result.source,'github');
  assert.equal(result.files.length,2);
  assert.match(result.files[0].text,/shared\/data\/a\.txt/);
  assert.deepEqual(calls,['shared/data']);
});

test('A gyorsítótár a megadott ideig megtartja az eredményt', async () => {
  let now = 1000;
  let reads = 0;
  const git = {
    status:()=>({configured:true}),
    listDataFiles:async()=>{reads += 1;return []},
    readTextFile:async()=>''
  };
  const sources = webSources({git,cacheMs:60000,now:()=>now});
  await sources.load();
  await sources.load();
  assert.equal(reads,1,'a második kérés a cache-ből jön');
  now = 100000;
  await sources.load();
  assert.equal(reads,2,'lejárat után újra olvas');
  sources.clear();
  await sources.load();
  assert.equal(reads,3,'a clear üríti a cache-t');
});

test('GitHub hiba esetén nem omlik össze, és a hiba is cache-elődik', async () => {
  let reads = 0;
  const git = {
    status:()=>({configured:true}),
    listDataFiles:async()=>{reads += 1;throw new Error('HTTP 500')},
    readTextFile:async()=>''
  };
  const sources = webSources({git,cacheMs:60000,now:()=>1000});
  const first = await sources.load();
  assert.equal(first.source,'error');
  assert.match(first.error,/HTTP 500/);
  const second = await sources.load();
  assert.equal(second.source,'error');
  assert.equal(reads,1,'a hiba nem terheli újra a kvótát');
});

test('Egy olvashatatlan fájl nem akasztja meg a többit', async () => {
  const git = {
    status:()=>({configured:true}),
    listDataFiles:async()=>[
      {path:'shared/data/a.txt',name:'a.txt'},
      {path:'shared/data/rossz.txt',name:'rossz.txt'}
    ],
    readTextFile:async file => {
      if(file.endsWith('rossz.txt')) throw new Error('HTTP 500');
      return 'hero=A';
    }
  };
  const sources = webSources({git,projectDir:'',cacheMs:0});
  const result = await sources.load();
  assert.equal(result.source,'github');
  assert.deepEqual(result.files.map(file => file.file),['a.txt']);
  assert.deepEqual(result.failed,['rossz.txt']);
});

test('Beállítás nélkül nincs forrás, de nem hiba', async () => {
  const sources = webSources({git:null,projectDir:'',cacheMs:0});
  const result = await sources.load();
  assert.equal(result.source,'none');
  assert.deepEqual(result.files,[]);
  assert.ok(result.missing.includes('SITE_GITHUB_REPO'));
});
