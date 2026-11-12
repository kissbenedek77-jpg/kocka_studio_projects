'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('Minden tulajdonosi oldal fejlĂ©cĂ©ben ott a kĂ¶zĂ¶s menĂĽ', () => {
  for (const file of ['dashboard_v2.html','technical.html','public/marketing.html','site.html']) {
    const html = read(file);
    assert.match(html,/class="[^"]*ks-app-menu/,
      file+': a kĂ¶zĂ¶s menĂĽ osztĂˇlya hiĂˇnyzik');
    assert.match(html,/href="\/dashboard"/,file+': nincs Dashboard link');
    assert.match(html,/href="\/marketing"/,file+': nincs Marketing link');
    assert.match(html,/href="\/site"/,file+': nincs Weboldal link');
    assert.match(html,/href="\/auth\/logout"/,file+': nincs KijelentkezĂ©s link');
  }
});

test('Az aktuĂˇlis oldal meg van jelĂ¶lve a menĂĽben', () => {
  assert.match(read('dashboard_v2.html'),/aria-current="page">Dashboard/);
  assert.match(read('public/marketing.html'),/aria-current="page">Marketing/);
  assert.match(read('site.html'),/aria-current="page">Weboldal/);
});

test('A kĂ¶zĂ¶s menĂĽ stĂ­lusa a megosztott CSS-ben van', () => {
  const css = read('public/theme/ks-theme.css');
  assert.match(css,/\.ks-app-menu\{/);
  assert.match(css,/\.ks-app-menu a\[aria-current=page\]/);
});

test('Mobilon hamburger gomb nyitja a menĂĽt', () => {
  const js = read('public/app-menu.js');
  assert.match(js,/ks-app-menu-toggle/);
  assert.match(js,/aria-expanded/);
  assert.match(js,/classList\.toggle\('open'/);
  const css = read('public/theme/ks-theme.css');
  assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?\.ks-app-menu-toggle\{display:inline-flex\}/);
  assert.match(css,/\.ks-app-menu\.open \.ks-app-menu-panel\{display:flex\}/);
  const server = read('server/index.cjs');
  assert.match(server,/'\/assets\/app-menu\.js'/);
  assert.match(server,/<script src="\/assets\/app-menu\.js"><\/script>/);
});
