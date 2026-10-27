'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const {createDownloadToken,readDownloadToken}=require('../server/email_download.cjs');

test('Node szerver: health elérhető, dashboard belépést kér, RPC nem nyilvános', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.cjs')], {
    env: {...process.env, PORT:'0', BASE_URL:'http://127.0.0.1:3000',
      LEGACY_PUBLIC_ORIGIN:'https://old.example.test', GOOGLE_CLIENT_ID:'test-client',
      GOOGLE_CLIENT_SECRET:'test-secret', OWNER_EMAIL:'owner@example.com', SESSION_SECRET:'x'.repeat(48),
      GEMINI_API_KEY:'',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_AI_TOKEN:''},
    stdio:['ignore','pipe','pipe']
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let text = '';
      const timeout = setTimeout(() => reject(new Error('A szerver nem indult el.')), 10000);
      child.stdout.on('data', chunk => {
        text += chunk;
        const match = text.match(/listening on (\d+)/);
        if (match) {clearTimeout(timeout); resolve(Number(match[1]));}
      });
      child.once('exit', code => {clearTimeout(timeout); reject(new Error('A szerver kilépett: ' + code));});
    });
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {ok:true});
    const design = await fetch(base + '/assets/ks-design.css');
    assert.equal(design.status, 200);
    assert.match(design.headers.get('content-type'), /text\/css/);
    assert.match(await design.text(), /--ks-primary:#77c59e/);
    const fontAwesomeCss=await fetch(base+'/assets/fontawesome/css/all.min.css');
    assert.equal(fontAwesomeCss.status,200);
    assert.match(fontAwesomeCss.headers.get('content-type'),/text\/css/);
    assert.match(await fontAwesomeCss.text(),/fa-file-pdf/);
    const fontAwesomeFont=await fetch(base+'/assets/fontawesome/webfonts/fa-solid-900.woff2');
    assert.equal(fontAwesomeFont.status,200);
    assert.match(fontAwesomeFont.headers.get('content-type'),/font\/woff2/);
    const regularFont=await fetch(base+'/assets/fontawesome/webfonts/fa-regular-400.woff2');
    assert.equal(regularFont.status,200);
    assert.match(regularFont.headers.get('content-type'),/font\/woff2/);
    const bootstrap = await fetch(base + '/assets/bootstrap.bundle.min.js');
    assert.equal(bootstrap.status, 200);
    assert.match(bootstrap.headers.get('content-type'), /application\/javascript/);
    const shell = await fetch(base + '/assets/ks-shell.js');
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /getOrCreateInstance/);
    const manifestResponse=await fetch(base+'/manifest.webmanifest');
    assert.equal(manifestResponse.status,200);
    assert.match(manifestResponse.headers.get('content-type'),/application\/manifest\+json/);
    const manifest=await manifestResponse.json();
    assert.equal(manifest.start_url,'/dashboard');
    assert.equal(manifest.display,'standalone');
    assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose.includes('maskable')));
    assert.ok(manifest.icons.every(icon=>icon.src.endsWith('?v=3')));
    const icon=await fetch(base+'/assets/kocka-icon-512.png');
    assert.equal(icon.status,200);
    assert.match(icon.headers.get('content-type'),/image\/png/);
    const iconBytes=Buffer.from(await icon.arrayBuffer());
    assert.equal(iconBytes.readUInt32BE(16),512);
    assert.equal(iconBytes.readUInt32BE(20),512);
    const svgResponse=await fetch(base+'/assets/kocka-icon.svg?v=4');
    assert.equal(svgResponse.status,200);
    assert.match(svgResponse.headers.get('content-type'),/image\/svg\+xml/);
    const svg=await svgResponse.text();
    const embeddedPng=/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
    assert.ok(embeddedPng);
    assert.deepEqual(Buffer.from(embeddedPng[1],'base64'),iconBytes);
    const worker=await fetch(base+'/service-worker.js');
    assert.equal(worker.status,200);
    assert.match(worker.headers.get('cache-control'),/no-cache/);
    assert.doesNotMatch(await worker.text(),/caches\.open|cache\.put/);
    const font = await fetch(base + '/assets/fonts/source-sans-pro-latin-ext-400-normal.woff2');
    assert.equal(font.status, 200);
    assert.match(font.headers.get('content-type'), /font\/woff2/);
    const headingFont=await fetch(base+'/assets/fonts/source-sans-pro-latin-ext-600-normal.woff2');
    assert.equal(headingFont.status,200);
    assert.match(headingFont.headers.get('content-type'),/font\/woff2/);
    const dashboard = await fetch(base + '/dashboard', {redirect:'manual'});
    assert.equal(dashboard.status, 302);
    assert.equal(dashboard.headers.get('location'), '/auth/login?return=%2Fdashboard');
    const marketing = await fetch(base + '/marketing', {redirect:'manual'});
    assert.equal(marketing.status, 302);
    assert.equal(marketing.headers.get('location'), '/auth/login?return=%2Fmarketing');
    const hiddenTopics=await fetch(base+'/api/marketing/posts/topics');
    assert.equal(hiddenTopics.status,401);
    const hiddenPublish=await fetch(base+'/api/marketing/posts/publish',{method:'POST'});
    assert.equal(hiddenPublish.status,401);
    const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update('x'.repeat(48)).digest();
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify({email:'owner@example.com',
      refreshToken:'test-refresh',exp:Date.now()+60000})),cipher.final()]);
    const session=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
    const marketingPage=await fetch(base+'/marketing',{headers:{Cookie:'kocka_session='+session}});
    assert.equal(marketingPage.status,200);
    const marketingHtml=await marketingPage.text();
    assert.match(marketingHtml,/\/assets\/fontawesome\/css\/all\.min\.css/);
    assert.match(marketingHtml,/rel="manifest" href="\/manifest\.webmanifest\?v=3"/);
    assert.match(marketingHtml,/\/assets\/pwa-register\.js/);
    assert.match(marketingHtml,/Marketing műhely/);
    assert.match(marketingHtml,/A kampányok és eredmények demóadatok/);
    assert.match(marketingHtml,/kocka-marketing-demo-v1/);
    assert.match(marketingHtml,/Arculati alapbeállítások/);
    assert.match(marketingHtml,/AI kreatívtervező/);
    assert.match(marketingHtml,/FLUX\.2 klein 4B/);
    const imageModels=await fetch(base+'/api/marketing/image/models',
      {headers:{Cookie:'kocka_session='+session}});
    assert.equal(imageModels.status,200);
    assert.equal((await imageModels.json()).models[1].available,false);
    const missingImageKey=await fetch(base+'/api/marketing/image',{method:'POST',
      headers:{Cookie:'kocka_session='+session,Origin:'http://127.0.0.1:3000',
        'x-kocka-rpc':'1','Content-Type':'application/json'},
      body:JSON.stringify({model:'flux-1-schnell',prompt:'kortárs ház',format:'square'})});
    assert.equal(missingImageKey.status,503);
    const privateAi=await fetch(base+'/api/marketing/creative',{method:'POST'});
    assert.equal(privateAi.status,401);
    const missingAiKey=await fetch(base+'/api/marketing/creative',{method:'POST',
      headers:{Cookie:'kocka_session='+session,Origin:'http://127.0.0.1:3000','x-kocka-rpc':'1'}});
    assert.equal(missingAiKey.status,503);
    const login = await fetch(base + '/auth/login');
    assert.equal(login.status,200);
    const loginHtml=await login.text();
    assert.match(loginHtml,/Belépés Google-fiókkal/);
    assert.match(loginHtml,/rel="apple-touch-icon"/);
    assert.match(loginHtml,/kocka-icon-180\.png\?v=3/);
    assert.match(loginHtml,/kocka-icon\.svg\?v=4/);
    const expiredDashboard=await fetch(base+'/dashboard?project=ABCD-1234',{
      headers:{Cookie:'kocka_session=expired'},redirect:'manual'});
    assert.equal(expiredDashboard.status,302);
    assert.equal(expiredDashboard.headers.get('location'),
      '/auth/login?return=%2Fdashboard%3Fproject%3DABCD-1234&reason=expired');
    assert.match(expiredDashboard.headers.get('set-cookie'),/Max-Age=0/);
    const expiredLogin=await fetch(base+'/auth/login?reason=expired');
    assert.match(await expiredLogin.text(),/A munkamenet lejárt/);
    const projectDashboard = await fetch(base + '/dashboard?project=ABCD-1234', {redirect:'manual'});
    assert.equal(projectDashboard.headers.get('location'), '/auth/login?return=%2Fdashboard%3Fproject%3DABCD-1234');
    const oldDashboardLink = await fetch(base + '/?view=dashboard&project=ABCD-1234', {redirect:'manual'});
    assert.equal(oldDashboardLink.headers.get('location'), '/dashboard?project=ABCD-1234');
    const home=await fetch(base+'/',{redirect:'manual'});
    assert.equal(home.status,302);
    assert.equal(home.headers.get('location'),'/dashboard');
    const landing=await fetch(base+'/ajanlatkeres');
    assert.equal(landing.status,200);
    const landingHtml=await landing.text();
    assert.doesNotMatch(landingHtml,/rel="manifest"/);
    assert.match(landingHtml,/id="inquiryForm"/);
    assert.match(landingHtml,/id="cameraPhoto"/);
    assert.match(landingHtml,/id="existingPhotos"/);
    const privateImage=await fetch(base+'/api/project-image?uid=ABCD-1234&file=photo-file-0001');
    assert.equal(privateImage.status,401);
    assert.match(privateImage.headers.get('content-type'),/application\/json/);
    const unavailable=await fetch(base+'/api/inquiry',{method:'POST'});
    assert.equal(unavailable.status,503);
    const form = await fetch(base + '/form?uid=ABCD-1234', {redirect:'manual'});
    assert.equal(form.status, 503);
    assert.match((await form.json()).error, /GOOGLE_TRACKING_CREDENTIAL/);
    const legacyRequest = path => new Promise((resolve,reject) => {
      http.get({hostname:'127.0.0.1',port,path,headers:{Host:'old.example.test'}},res => {
        res.resume();res.on('end',()=>resolve(res));
      }).on('error',reject);
    });
    const legacyForm = await legacyRequest('/form?uid=ABCD-1234');
    assert.equal(legacyForm.statusCode,302);
    assert.equal(legacyForm.headers.location,'http://127.0.0.1:3000/form?uid=ABCD-1234');
    const rpc = await fetch(base + '/api/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:'dashboardListProjects', args:[]})});
    assert.equal(rpc.status, 401);
    const expiredRpc=await fetch(base+'/api/rpc',{method:'POST',
      headers:{Cookie:'kocka_session=expired','Content-Type':'application/json'},
      body:JSON.stringify({name:'dashboardListProjects',args:[]})});
    assert.equal(expiredRpc.status,401);
    assert.match(expiredRpc.headers.get('set-cookie'),/Max-Age=0/);
    const token=createDownloadToken('x'.repeat(48),{uid:'ABC123',kind:'offer',
      to:'client@example.com',subject:'Ajánlat',refreshToken:'test-refresh-token',
      files:[{id:'document12345',filename:'ajanlat.pdf',mimeType:'application/vnd.google-apps.document'}]});
    assert.equal(readDownloadToken('x'.repeat(48),token).uid,'ABC123');
    const download=await fetch(base+'/download/'+token);
    assert.equal(download.status,200,download.status===200?'':await download.clone().text());
    const oldDownload=await legacyRequest('/download/'+token);
    assert.equal(oldDownload.statusCode,200);
    const downloadHtml=await download.text();
    assert.match(downloadHtml,/ajanlat\.pdf/);
    assert.match(downloadHtml,/data-path="\/download\//);
    const downloadClient=await fetch(base+'/download-client.js');
    assert.equal(downloadClient.status,200);
    assert.match(await downloadClient.text(),/startDownload\(\)/);
    assert.equal((await fetch(base+'/download/bad-token')).status,404);
  } finally {child.kill();}
});
