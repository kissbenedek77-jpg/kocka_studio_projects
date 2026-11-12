'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('Minden tulajdonosi oldal fejlécében ott a közös menü', () => {
  for (const file of ['dashboard_v2.html','technical.html','public/marketing.html','site.html']) {
    const html = read(file);
    assert.match(html,/class="[^"]*ks-app-menu/,
      file+': a közös menü osztálya hiányzik');
    assert.match(html,/href="\/dashboard"/,file+': nincs Dashboard link');
    assert.match(html,/href="\/marketing"/,file+': nincs Marketing link');
    assert.match(html,/href="\/site"/,file+': nincs Weboldal link');
    assert.match(html,/href="\/auth\/logout"/,file+': nincs Kijelentkezés link');
  }
});

test('Az aktuális oldal meg van jelölve a menüben', () => {
  assert.match(read('dashboard_v2.html'),/aria-current="page">Dashboard/);
  assert.match(read('public/marketing.html'),/aria-current="page">Marketing/);
  assert.match(read('site.html'),/aria-current="page">Weboldal/);
});

test('A közös menü stílusa a megosztott CSS-ben van', () => {
  const css = read('public/ks-design.css');
  assert.match(css,/\.ks-app-menu\{/);
  assert.match(css,/\.ks-app-menu a\[aria-current=page\]/);
});
