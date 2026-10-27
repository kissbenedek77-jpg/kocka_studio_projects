'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {hashPassword,verifyPassword,normalizeUsername}=require('../server/local_auth.cjs');
const {createTrackingCredential,readTrackingCredential}=require('../server/tracking_credential.cjs');

test('A helyi jelszó sózott, és csak a helyes értékkel egyezik',()=>{
  const hash=hashPassword('hosszú próba jelszó 123');
  assert.notEqual(hash,hashPassword('hosszú próba jelszó 123'));
  assert.equal(verifyPassword('hosszú próba jelszó 123',hash),true);
  assert.equal(verifyPassword('hibás próba jelszó',hash),false);
});

test('A felhasználónév egységesített és ellenőrzött',()=>{
  assert.equal(normalizeUsername(' Benedek.Studio '),'benedek.studio');
  assert.throws(()=>normalizeUsername('a'),/felhasználónév/);
  assert.throws(()=>normalizeUsername('rossz név'),/felhasználónév/);
});

test('Saját belépés után a dashboard Google-ablak nélkül megnyílik',async()=>{
  const secret='s'.repeat(48),owner='owner@example.com';
  const child=spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:owner,SESSION_SECRET:secret,
      LOCAL_LOGIN_PASSWORD_HASH:hashPassword('hosszú próba jelszó 123'),
      GOOGLE_TRACKING_CREDENTIAL:createTrackingCredential(secret,owner,'test-refresh-token')},
    stdio:['ignore','pipe','pipe']
  });
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('A szerver nem indult el.')),10000);
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('A szerver kilépett: '+code));});
    });
    const base=`http://127.0.0.1:${port}`;
    const login=await fetch(base+'/auth/login?return=%2Fdashboard%3Fproject%3DABCD-1234');
    const loginHtml=await login.text();
    assert.match(loginHtml,/name="username"/);
    assert.match(loginHtml,/name="password"/);
    const wrong=await fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:owner,password:'rossz',return:'/dashboard?project=ABCD-1234'})});
    assert.equal(wrong.status,401);
    const wrongUser=await fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:'someone-else',password:'hosszú próba jelszó 123'})});
    assert.equal(wrongUser.status,401);
    assert.match(await wrongUser.text(),/Hibás felhasználónév vagy jelszó/);
    const crossSite=await fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'https://example.test','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:owner,password:'hosszú próba jelszó 123'})});
    assert.equal(crossSite.status,403);
    const good=await fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:owner.toUpperCase(),password:'hosszú próba jelszó 123',return:'/dashboard?project=ABCD-1234'})});
    assert.equal(good.status,302);
    assert.equal(good.headers.get('location'),'/dashboard?project=ABCD-1234');
    const invalidReturn=await fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username:owner,password:'hosszú próba jelszó 123',return:'//example.test'})});
    assert.equal(invalidReturn.headers.get('location'),'/dashboard');
    const cookie=good.headers.get('set-cookie').split(';')[0];
    const dashboard=await fetch(base+'/dashboard',{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(dashboard.status,200);
    assert.match(await dashboard.text(),/Projektek, egy helyen/);
    const rpc=async(name,args=[])=>{
      const response=await fetch(base+'/api/rpc',{method:'POST',headers:{
        Cookie:cookie,Origin:'http://127.0.0.1:3000','Content-Type':'application/json','X-Kocka-RPC':'1'
      },body:JSON.stringify({name,args})});
      return {status:response.status,body:await response.json()};
    };
    const status=await rpc('dashboardLocalLoginStatus');
    assert.equal(status.status,200);
    assert.equal(status.body.result.ready,true);
    assert.equal(status.body.result.username,owner);
    const prepared=await rpc('dashboardPrepareLocalLogin',[{username:' Studio.Owner ',password:'még hosszabb próba jelszó 456'}]);
    assert.equal(prepared.status,200);
    assert.equal(prepared.body.result.username,'studio.owner');
    assert.equal(verifyPassword('még hosszabb próba jelszó 456',prepared.body.result.passwordHash),true);
    assert.equal(readTrackingCredential(secret,prepared.body.result.googleCredential,owner),'test-refresh-token');
    const short=await rpc('dashboardPrepareLocalLogin',[{username:'studio.owner',password:'rövid'}]);
    assert.equal(short.status,400);
    const invalidUsername=await rpc('dashboardPrepareLocalLogin',[{username:'bad name',password:'még hosszabb próba jelszó 456'}]);
    assert.equal(invalidUsername.status,400);
    const logout=await fetch(base+'/auth/logout',{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(logout.headers.get('location'),'/auth/login');
    assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  }finally{child.kill();}
});

test('Az egyedi felhasználónév a jelszóval együtt szükséges a belépéshez',async()=>{
  const secret='t'.repeat(48),owner='owner@example.com';
  const child=spawn(process.execPath,[path.join(__dirname,'..','server','index.cjs')],{
    env:{...process.env,PORT:'0',BASE_URL:'http://127.0.0.1:3000',
      GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
      OWNER_EMAIL:owner,SESSION_SECRET:secret,LOCAL_LOGIN_USERNAME:'Studio.Owner',
      LOCAL_LOGIN_PASSWORD_HASH:hashPassword('hosszú próba jelszó 123'),
      GOOGLE_TRACKING_CREDENTIAL:createTrackingCredential(secret,owner,'test-refresh-token')},
    stdio:['ignore','pipe','pipe']
  });
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(new Error('A szerver nem indult el.')),10000);
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('A szerver kilépett: '+code));});
    });
    const base=`http://127.0.0.1:${port}`;
    const signIn=username=>fetch(base+'/auth/local',{method:'POST',redirect:'manual',
      headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({username,password:'hosszú próba jelszó 123'})});
    assert.equal((await signIn(owner)).status,401);
    const good=await signIn('STUDIO.OWNER');
    assert.equal(good.status,302);
    const cookie=good.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/dashboard',{headers:{Cookie:cookie},redirect:'manual'})).status,200);
  }finally{child.kill();}
});
