'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');

test('Node szerver: health, űrlap és védett RPC', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.cjs')], {
    env: {...process.env, PORT:'0', BASE_URL:'http://127.0.0.1:3000', GOOGLE_CLIENT_ID:'test-client',
      GOOGLE_CLIENT_SECRET:'test-secret', OWNER_EMAIL:'owner@example.com', SESSION_SECRET:'x'.repeat(48),
      OWNER_REFRESH_TOKEN:''},
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

    const dashboard = await fetch(base + '/dashboard', {redirect:'manual'});
    assert.equal(dashboard.status, 302);
    assert.equal(dashboard.headers.get('location'), '/auth/login');

    const form = await fetch(base + '/form?uid=ABC123');
    assert.equal(form.status, 200);
    const html = await form.text();
    assert.match(html, /const INITIAL_UID='ABC123'/);
    assert.match(html, /fetch\('\/api\/form'/);

    const badForm = await fetch(base + '/form?uid=x');
    assert.equal(badForm.status, 400);

    const rpc = await fetch(base + '/api/rpc', {method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:'dashboardListProjects', args:[]})});
    assert.equal(rpc.status, 401);

    const formPost = await fetch(base + '/api/form', {method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:'getData', args:['ABC123']})});
    assert.equal(formPost.status, 403);

    const formWithoutToken = await fetch(base + '/api/form', {method:'POST',
      headers:{'Content-Type':'application/json','X-Kocka-Form':'1'},
      body:JSON.stringify({name:'getData', args:['ABC123']})});
    assert.equal(formWithoutToken.status, 503);
    assert.match((await formWithoutToken.json()).error, /OWNER_REFRESH_TOKEN/);

    const unknown = await fetch(base + '/nem-letezik');
    assert.equal(unknown.status, 404);
  } finally {child.kill();}
});
