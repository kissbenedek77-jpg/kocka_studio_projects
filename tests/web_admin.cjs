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

test('A szerkesztő a weboldal git repójába publikál', () => {
  assert.match(html,/Publikálás a weboldalba/);
  assert.match(html,/'webPublish'/);
  assert.match(html,/Publikálás: GitHub/);
  assert.doesNotMatch(html,/Állítsd be a WEB_PROJECT_DIR változót/,'élesben nincs helyi mappa');
  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
  assert.match(server,/webPublish/);
  assert.match(server,/require\('\.\/web_git\.cjs'\)/);
  assert.match(server,/SITE_GITHUB_TOKEN/);
  assert.match(server,/SITE_GITHUB_REPO/);
  const git = fs.readFileSync(path.join(root,'server','web_git.cjs'),'utf8');
  assert.match(git,/git\/blobs/);
  assert.match(git,/git\/trees/);
  assert.match(git,/git\/commits/);
  assert.match(git,/base_tree/);
  const publisher = fs.readFileSync(path.join(root,'server','web_publish.cjs'),'utf8');
  assert.match(publisher,/shared,'data'/);
  assert.match(publisher,/shared,'js'/);
  assert.match(publisher,/projects\.js/);
  assert.match(publisher,/mediaUrl/,'a feltöltött kép abszolút URL-t kap');
});

test('Publikálás után Railway deploy indul, és kézzel is indítható', () => {
  assert.match(html,/id="railwayButton"/);
  assert.match(html,/Railway frissítés/);
  assert.match(html,/'webRailwayDeploy'/);
  assert.match(html,/Railway deploy: nincs beállítva/);
  assert.match(html,/result\.deploy\.triggered/);
  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
  assert.match(server,/require\('\.\/railway\.cjs'\)/);
  assert.match(server,/publishWebsite\(\)/,'a webPublish deployt is indít');
  assert.match(server,/webRailwayDeploy/);
  assert.match(server,/SITE_DEPLOY_SERVICE_ID/);
  assert.match(server,/SITE_DEPLOY_ENVIRONMENT_ID/);
  assert.doesNotMatch(server,/process\.env\.RAILWAY_/,'a Railway saját RAILWAY_* változóit nem olvassuk');
  const railway = fs.readFileSync(path.join(root,'server','railway.cjs'),'utf8');
  assert.match(railway,/serviceInstanceRedeploy/);
  assert.match(railway,/Project-Access-Token/);
  assert.match(railway,/Authorization/);
  assert.match(railway,/environmentTriggersDeploy/);
  // A token nem kerülhet a válaszba vagy a hibaüzenetbe.
  assert.doesNotMatch(railway,/token\s*:\s*token/);
  assert.match(railway,/configured: missing\.length === 0/);
});

test('A form mezői a data fájlokból származnak, új fájl build nélkül megjelenik', () => {
  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
  assert.match(server,/require\('\.\/web_sources\.cjs'\)/);
  assert.match(server,/pagesFromFiles\(structure\.files\)/);
  assert.match(server,/siteStore\.syncPages\(scanned\)/);
  assert.match(server,/structure: \{source: structure\.source/);
  const sources = fs.readFileSync(path.join(root,'server','web_sources.cjs'),'utf8');
  assert.match(sources,/listDataFiles/,'a repó fájljait listázza');
  assert.match(sources,/cacheMs/,'rövid gyorsítótár');
  const content = fs.readFileSync(path.join(root,'server','web_content.cjs'),'utf8');
  assert.match(content,/function pagesFromFiles/);
  assert.match(content,/function mergePages/);
  assert.match(content,/function hasBlocks/);
  assert.match(html,/id="structureInfo"/);
  assert.match(html,/A mezők a weboldal/);
  assert.match(html,/id="refreshStructure"/);
  assert.match(html,/webRefreshStructure/);
  assert.match(server,/webRefreshStructure/);
  assert.match(server,/siteSources\.clear\(\)/,'a kézi frissítés kihagyja a gyorsítótárat');
  assert.match(server,/async function syncSiteStructure\(\)/);
  assert.match(server,/const structure = await syncSiteStructure\(\);/,
    'a publikálás előtt a fájlokból frissül a szerkezet');
  assert.match(server,/biztonsági okból nem indult el/,
    'olvashatatlan data fájl esetén a publikálás nem ír felül');
});

test('A szerver kiszolgálja és védi az oldalt', () => {  const server = fs.readFileSync(path.join(root,'server','index.cjs'),'utf8');
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
