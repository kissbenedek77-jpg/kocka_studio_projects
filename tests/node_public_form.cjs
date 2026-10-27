'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {createTrackingCredential}=require('../server/tracking_credential.cjs');

test('Szolgáltatásfiókkal a Node űrlap nyilvánosan megjelenik, az API eredetellenőrzött', async () => {
  const child = spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:'owner@example.com',SESSION_SECRET:'x'.repeat(48),
      GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'robot@example.test',
        private_key:'unused-test-key'})},stdio:['ignore','pipe','pipe']
  });
  try {
    const port = await new Promise((resolve,reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('A szerver nem indult el.')),10000);
      child.stdout.on('data',chunk => {output += chunk;
        const match = output.match(/listening on (\d+)/);
        if (match) {clearTimeout(timeout); resolve(Number(match[1]));}
      });
      child.once('exit',code => {clearTimeout(timeout); reject(new Error('Kilépett: '+code));});
    });
    const base = `http://127.0.0.1:${port}`;
    const form = await fetch(base+'/form?uid=ABC123',{redirect:'manual'});
    assert.equal(form.status,200);
    assert.match(await form.text(),/const INITIAL_UID="ABC123"/);
    const ownerEditor = await fetch(base+'/form?uid=ABC123&embed=1',{redirect:'manual'});
    assert.equal(ownerEditor.status,401);
    const blocked = await fetch(base+'/api/form',{method:'POST',
      headers:{'Content-Type':'application/json','X-Kocka-Form':'1'},
      body:JSON.stringify({name:'getData',args:['ABC123']})});
    assert.equal(blocked.status,403);
  } finally {child.kill();}
});

test('Hiányos szolgáltatásfiók-adat mellett a kulcs nélküli OAuth-hitelesítő indítja a Node űrlapot',async()=>{
  const secret='x'.repeat(48);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:'owner@example.com',SESSION_SECRET:secret,
      GOOGLE_SERVICE_ACCOUNT_JSON:'{}',GOOGLE_TRACKING_CREDENTIAL:createTrackingCredential(
        secret,'owner@example.com','test-refresh-token')},stdio:['ignore','pipe','pipe']
  });
  try{const port=await new Promise((resolve,reject)=>{
    let output='';const timeout=setTimeout(()=>reject(new Error('A szerver nem indult el.')),10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);
      if(match){clearTimeout(timeout);resolve(Number(match[1]))}});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Kilépett: '+code))});
  });
    const response=await fetch(`http://127.0.0.1:${port}/form?uid=ABC123`,{redirect:'manual'});
    assert.equal(response.status,200);
    assert.match(await response.text(),/const INITIAL_UID="ABC123"/);
  }finally{child.kill()}
});

test('Hiányos opcionális szolgáltatásfiók-adat nem állítja le a követés beállításához szükséges szervert',async()=>{
  const child=spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:'owner@example.com',SESSION_SECRET:'x'.repeat(48),
      GOOGLE_SERVICE_ACCOUNT_JSON:'{}',GOOGLE_TRACKING_CREDENTIAL:''},
    stdio:['ignore','pipe','pipe']
  });
  try{const port=await new Promise((resolve,reject)=>{
    let output='';const timeout=setTimeout(()=>reject(new Error('A szerver nem indult el.')),10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);
      if(match){clearTimeout(timeout);resolve(Number(match[1]))}});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Kilépett: '+code))});
  });
    const response=await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status,200);
  }finally{child.kill()}
});
