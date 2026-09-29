const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard_v2.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
assert.deepEqual(manifest.webapp, {executeAs: 'USER_ACCESSING', access: 'MYSELF'});
const script = html.match(/<script>([\s\S]*?)<\/script>/);
assert(script, 'A dashboard kliensoldali kódja hiányzik.');
new vm.Script(script[1]);

const rows = [
  Object.assign(Array(40).fill(''), {0: 'ABC123', 2: 'AKTÍV', 7: 'Kiss', 8: 'Anna', 38: 'Magyaratád 531'}),
  Object.assign(Array(40).fill(''), {0: 'DEF456', 2: 'KÉSZ', 7: 'Nagy', 8: 'Béla', 38: 'Somogyaszaló 12'})
];
let status = '';
const sheet = {
  getLastRow: () => 3,
  getRange: () => ({getDisplayValues: () => rows,
    getRichTextValues: () => [[{getLinkUrl: () => ''}], [{getLinkUrl: () => ''}]],
    setValue: value => {status = value;}}),
  appendRow: row => {sheet.lastAppended = row;}
};
let locked = false;
const context = vm.createContext({
  Session: {getActiveUser: () => ({getEmail: () => 'owner@example.com'}), getEffectiveUser: () => ({getEmail: () => 'owner@example.com'})},
  SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'Adatok' ? sheet : null})},
  HtmlService: {createTemplateFromFile: name => ({name, evaluate() {return this;}, setTitle() {return this;}, addMetaTag() {return this;}})},
  LockService: {getScriptLock: () => ({tryLock() {locked = true; return true;}, releaseLock() {locked = false;}})},
  Utilities: {formatDate: () => '2609'},
  PropertiesService: {getScriptProperties: () => ({setProperty: (key, value) => {context.aiProperty = [key, value];}})}
});
vm.runInContext(source, context);
assert.equal(context.doGet({parameter: {view: 'dashboard'}}).name, 'dashboard_v2');
context.Session.getActiveUser = () => ({getEmail: () => ''});
assert.throws(() => context.dashboardListProjects(), /telepítő Google-fiókja/);
context.Session.getActiveUser = () => ({getEmail: () => 'owner@example.com'});
const projects = context.dashboardListProjects();
assert.deepEqual(Array.from(projects, p => p.closed), [true, false]);
assert.deepEqual(Array.from(projects, p => p.order), [3, 2]);
assert.deepEqual(Array.from(projects, p => p.clientName), ['Nagy Béla', 'Kiss Anna']);
assert.equal(context.validateRestartPostfix_(''), 'MOD_2609');
assert.throws(() => context.validateRestartPostfix_('x/y'), /tiltott karakter/);
const fileFolder = {getFilesByName: name => ({hasNext: () => name === 'EK-01.pdf'})};
const fileRoot = {getFoldersByName: name => ({hasNext: () => name === 'PDFA', next: () => fileFolder})};
assert.equal(context.projectRelativeFileExists_(fileRoot, 'PDFA/EK-01.pdf'), true);
assert.equal(context.projectRelativeFileExists_(fileRoot, 'PDFA/EK-02.pdf'), false);
assert.equal(context.restartExpectedPath_('PDFA/EK-01.pdf', 'MOD_2609'), 'PDFA/EK-01 - MOD_2609.pdf');
assert.equal(context.restartExpectedPath_('PLN/helyiségek.txt', 'MOD_2609'), 'PLN/helyiségek.txt');
assert.throws(() => context.dashboardConfigureAi('short'), /Érvénytelen/);
context.dashboardConfigureAi('AIzaExampleKeyForLocalTestOnly123456789');
assert.equal(context.aiProperty[0], 'GEMINI_API_KEY');

const ctx = {uid: 'ABC123', sheet, rowNumber: 2, data: {uid: 'ABC123', status: 'AKTÍV', email: 'client@example.com'}};
const project = {uid: 'ABC123', name: 'Magyaratád 531', stage: 'started', issues: [], documents: [{type: 'muszakiLeiras', url: 'https://docs.google.com/test'}]};
let moved = 0, finalized = 0, generated = 0, written = 0;
context.getProjectContextByUid_ = () => ctx;
context.getDashboardProject = () => project;
context.getProjectsParentFolder = () => ({});
context.getStartedProjectsFolder_ = () => ({});
context.getProjectFolderForMove_ = () => ({getUrl: () => 'https://drive.google.com/drive/folders/test'});
context.getFinalizableProjectRecords_ = () => [{type: 'ajanlat'}];
context.assertProjectFolderDestinationAvailable_ = () => {};
context.finalizeProjectDocuments_ = () => {finalized++; return {finalized: 1};};
context.finalizeWrittenDocuments_ = () => {written++;};
context.ensureProjectDataSpreadsheet_ = () => ({});
context.setProjectDashboardLink_ = () => {};
context.markDashboardStarted_ = () => {};
context.findOrCreateSubfolder = () => ({});
context.moveProjectFolder_ = () => {moved++;};
context.generateDocumentForContext_ = () => {generated++; return {created: true, url: 'https://docs.google.com/document/d/test'};};
let offerValues = null, offerSync = 0;
ctx.sheet = {getRange: () => ({setValues: values => {offerValues = values;}})};
context.syncProjectByUid_ = () => {offerSync++;};
const offerInput = {totalFee: '1000000', optionalFee: '200000', currency: 'Ft', currencyLong: 'forint', deadline5: '14'};
assert.throws(() => context.dashboardSaveOffer('ABC123', {...offerInput, deadline5: '-1'}), /egész napokban/);
context.dashboardSaveOffer('ABC123', offerInput);
assert.equal(offerValues[0].length, 24);
assert.equal(offerValues[0][0], '1000000');
assert.equal(offerValues[0][11], '14');
assert.equal(offerSync, 1);
ctx.sheet = sheet;
context.Utilities.formatDate = (value, zone, pattern) => pattern === 'yyyy-MM-dd' ? '2026-09-29' : '2609';
let startDate = null;
context.getDashboardSheet_ = () => ({getLastRow: () => 1, appendRow: row => {startDate = row[1];}});
assert.throws(() => context.dashboardSetStartDate('ABC123', '2026-02-30'), /Érvénytelen|hibás/);
assert.throws(() => context.dashboardSetStartDate('ABC123', '2026-10-01'), /jövőbeli/);
context.dashboardSetStartDate('ABC123', '2026-09-01');
assert.equal(startDate.toISOString().slice(0, 10), '2026-09-01');
assert.throws(() => context.dashboardPerform('ABC123', 'start', ''), /megerősítése/);
assert.equal(moved, 0);
context.dashboardPerform('ABC123', 'start', 'start:ABC123');
assert.equal(finalized, 1);
assert.equal(generated, 2);
assert.equal(moved, 1);
assert.equal(status, 'AKTÍV');
assert.equal(locked, false);
assert.throws(() => context.dashboardPerform('ABC123', 'document:unknown', ''), /Ismeretlen dokumentumtípus/);
context.dashboardPerform('ABC123', 'document:ajanlat', '');
assert.equal(generated, 3);
assert.throws(() => context.dashboardPerform('ABC123', 'close', ''), /megerősítése/);
context.dashboardPerform('ABC123', 'close', 'close:ABC123');
assert.equal(written, 1);
assert.equal(moved, 2);
assert.equal(status, 'KÉSZ');
let sent = null;
context.MailApp = {sendEmail: mail => {sent = mail;}};
assert.throws(() => context.dashboardSendEmail('ABC123', 'intake', ''), /megerősítése/);
assert.equal(sent, null);
context.dashboardSendEmail('ABC123', 'intake', 'email:intake:ABC123');
assert.equal(sent.to, 'client@example.com');
assert.match(sent.body, /script\.google\.com/);

ctx.uid = 'DEF456';
ctx.data.status = 'ELŐKÉSZÍTÉS'; // régi _Lezárt mappás projektek státusza még lehetett ilyen
context.getExistingProjectFolder = () => ({getName: () => 'Régi projekt', getParents: () => ({hasNext: () => true, next: () => ({getName: () => '_Elkészült'})})});
const newFolder = {getUrl: () => 'https://drive.google.com/drive/folders/new'};
context.getProjectsParentFolder = () => ({getFoldersByName: () => ({hasNext: () => false}), createFolder: () => newFolder});
context.copyProjectTree_ = () => {};
context.generateUniqueUID = () => 'NEW789';
context.setProjectFolderLink = () => {};
context.getDashboardSheet_ = () => ({appendRow: () => {}});
context.getExpectedProjectFiles_ = () => '';
context.getProjectDocumentRecords_ = () => [];
assert.throws(() => context.dashboardRestartProject('DEF456', '', ''), /megerősítése/);
const restarted = context.dashboardRestartProject('DEF456', '', 'restart:DEF456');
assert.equal(restarted.uid, 'NEW789');
assert.equal(restarted.postfix, 'MOD_2609');
assert.equal(sheet.lastAppended[2], 'ELŐKÉSZÍTÉS');
const rootFolder = {
  getId: () => 'root123456', getName: () => 'Projekt',
  getFolders: () => {let pending = true; return {hasNext: () => pending, next: () => {pending = false; return childFolder;}};},
  getFiles: () => ({hasNext: () => false})
};
const childFolder = {
  getId: () => 'child12345', getName: () => 'PDFA',
  getParents: () => ({hasNext: () => true, next: () => rootFolder}),
  getFolders: () => ({hasNext: () => false}),
  getFiles: () => ({hasNext: () => false})
};
const foreignFolder = {
  getId: () => 'foreign1234',
  getParents: () => ({hasNext: () => false})
};
context.getExistingProjectFolder = () => rootFolder;
context.DriveApp = {getFolderById: id => id === 'child12345' ? childFolder : foreignFolder};
assert.equal(context.dashboardListFolder('DEF456', '').folders[0].name, 'PDFA');
assert.equal(context.dashboardListFolder('DEF456', 'child12345').name, 'PDFA');
assert.throws(() => context.dashboardListFolder('DEF456', 'foreign1234'), /nem a kiválasztott projekthez/);
context.PropertiesService.getScriptProperties = () => ({getProperty: key => ({IMAP_BRIDGE_URL: 'https://example.test', IMAP_BRIDGE_TOKEN: 'test-token'})[key] || ''});
let bridgeRequest = null;
context.UrlFetchApp = {fetch: (url, options) => {bridgeRequest = {url, options}; return {getResponseCode: () => 200, getContentText: () => JSON.stringify({messages: []})};}};
context.dashboardListSentMail('DEF456');
assert.equal(JSON.parse(bridgeRequest.options.payload).recipient, 'client@example.com');
assert.throws(() => context.dashboardGetSentMail('DEF456', 'not-an-id'), /Érvénytelen levélazonosító/);
console.log('Dashboard jogosultság, státuszok és életciklus: OK');
