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

test('A szövegmezők a közös AI-sávot használják', () => {
  assert.match(html,/AiComposer\.create/);
  assert.match(html,/chat\.register/);
  assert.match(html,/'webAiText'/);
  const composer = fs.readFileSync(path.join(root,'public','ai-composer.js'),'utf8');
  assert.match(composer,/Felülírás/);
  assert.match(composer,/Kiegészítés/);
  assert.match(composer,/overwrite\.checked/);
  assert.match(composer,/append\.checked/);
  assert.match(composer,/position:fixed/,'a sáv alul rögzített');
  const technical = fs.readFileSync(path.join(root,'technical.html'),'utf8');
  assert.match(technical,/AiComposer\.create/,'a műszaki leírás is a közös modult használja');
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
  assert.match(server,/'\/assets\/ai-composer\.js'/);
  assert.match(server,/<script src="\/assets\/ai-composer\.js"><\/script>/);
  assert.match(server,/loginLocation\('\/site'/);
});
