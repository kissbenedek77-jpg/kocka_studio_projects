'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'..');
const html = fs.readFileSync(path.join(root,'site.html'),'utf8');

test('A weboldal-szerkesztő oldal elkészül', () => {
  assert.match(html,/Weboldal tartalma/);
  assert.match(html,/id="nav"/);
  assert.match(html,/id="panel"/);
});

test('A szövegmezők AI-segítséget kapnak felülírással és kiegészítéssel', () => {
  assert.match(html,/Felülírás/);
  assert.match(html,/Kiegészítés/);
  assert.match(html,/'webAiText'/);
  assert.match(html,/overwrite\.checked/);
  assert.match(html,/append\.checked/);
  assert.match(html,/current\+'\\n\\n'\+value/,
    'kiegészítésnél a meglévő szöveg után fűzi a javaslatot');
});

test('A fotók feltölthetők, törölhetők és sorrendezhetők', () => {
  assert.match(html,/webUploadImage/);
  assert.match(html,/webDeleteImage/);
  assert.match(html,/webReorderImages/);
  assert.match(html,/image\/jpeg,image\/png,image\/webp/);
  assert.match(html,/thumb/);
  assert.match(html,/8 MB/);
});

test('A projektek szerkeszthetők és sorrendezhetők', () => {
  assert.match(html,/webSaveProject/);
  assert.match(html,/webReorderProjects/);
  assert.match(html,/webAddProject/);
  assert.match(html,/webDeleteProject/);
});

test('A szerkesztő publikál a weboldal projektjébe', () => {
  assert.match(html,/Publikálás a weboldalba/);
  assert.match(html,/'webPublish'/);
  assert.match(html,/WEB_PROJECT_DIR/);
  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
  assert.match(server,/webPublish/);
  const publisher = fs.readFileSync(path.join(root,'server','web_publish.cjs'),'utf8');
  assert.match(publisher,/shared,'data'/);
  assert.match(publisher,/shared,'js'/);
  assert.match(publisher,/projects\.js/);
});

test('A szerver kiszolgálja és védi az oldalt', () => {
  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
  assert.match(server,/url\.pathname === '\/site'/);
  assert.match(server,/webGetContent/);
  assert.match(server,/webSaveField/);
  assert.match(server,/webUploadImage/);
  assert.match(server,/url\.pathname === '\/api\/web\/content'/);
  assert.match(server,/'\/media\/web\/'/);
  assert.match(server,/'\/assets\/message-center\.js'/);
  assert.match(server,/loginLocation\('\/site'/);
});
