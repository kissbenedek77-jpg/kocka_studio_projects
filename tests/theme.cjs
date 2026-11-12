'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('A téma csomag tartalmazza a brand tokeneket és a Bootstrap változókat', () => {
  const css = read('public/theme/ks-theme.css');
  for (const token of ['--ks-dark','--ks-ink','--ks-muted','--ks-line','--ks-gold',
    '--ks-mint','--ks-bg','--ks-surface','--ks-danger','--ks-success','--ks-warning'])
    assert.match(css,new RegExp(token+':'),token+' hiányzik');
  assert.match(css,/--bs-body-font-family/);
  assert.match(css,/--bs-border-color/);
  assert.match(css,/--bs-focus-ring-color/);
  assert.match(css,/\.btn-primary/);
  assert.match(css,/\.form-control/);
  assert.match(css,/\.card/);
  assert.match(css,/\.alert/);
  assert.match(css,/\.badge/);
});

test('A téma a régi osztályokat is a közös arculatra képezi', () => {
  const css = read('public/theme/ks-theme.css');
  for (const legacy of ['.button','.panel','.notice','.field'])
    assert.ok(css.includes(legacy),legacy+' aliasing hiányzik');
});

test('A téma minden oldalra betöltődik, a Bootstrap után', () => {
  const server = read('server/index.cjs');
  assert.match(server,/'\/assets\/theme\/ks-theme\.css'/);
  assert.match(server,/<\/style>\\n  <link rel="stylesheet" href="\/assets\/theme\/ks-theme\.css">/);
  assert.match(server,/bootstrap\.min\.css[\s\S]*theme\/ks-theme\.css/);
  assert.doesNotMatch(server,/ks-design\.css/,'a külön stíluslap megszűnt');
  assert.equal(fs.existsSync(path.join(root,'public','ks-design.css')),false);
});

test('A futásidejű modulok a téma tokenjeit használják', () => {
  for (const file of ['public/ai-composer.js','public/message-center.js'])
    assert.match(read(file),/var\(--ks-(dark|ink|gold|line|muted)/,
      file+': nem hivatkozik a téma tokenjeire');
});
