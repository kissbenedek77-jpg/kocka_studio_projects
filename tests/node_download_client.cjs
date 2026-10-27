'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('A 30 napos tájékoztatás csak a fájl böngészőbe érkezése után látszik',async()=>{
  const page={dataset:{path:'/download/token/file/0',filename:'ajanlat.pdf',
    expires:String(Date.parse('2026-11-03T12:00:00Z'))}};
  const status={textContent:'',classList:{add(){},remove(){}}};
  const validity={hidden:true,textContent:''};let clicked=false,resolveBlob;
  const blobPromise=new Promise(resolve=>{resolveBlob=resolve});
  const document={getElementById:id=>({download:page,downloadStatus:status,
    downloadValidity:validity})[id],createElement:()=>({click(){clicked=true},remove(){}}),
    body:{append(){}}};
  const source=fs.readFileSync(path.join(__dirname,'..','server','download_client.js'),'utf8')
    .replace(/startDownload\(\);\s*$/,'');
  const context=vm.createContext({document,fetch:async()=>({ok:true,blob:()=>blobPromise}),
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout(){}});
  vm.runInContext(source,context);
  const pending=context.startDownload();
  assert.equal(validity.hidden,true);
  assert.equal(clicked,false);
  resolveBlob({size:5});await pending;
  assert.equal(clicked,true);
  assert.equal(validity.hidden,false);
  assert.match(validity.textContent,/30 napig/);
  assert.match(status.textContent,/A letöltés elindult/);
});
