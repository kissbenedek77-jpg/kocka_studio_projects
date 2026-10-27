'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDashboard} = require('../server/dashboard.cjs');
const {renderForm, handleFormRequest} = require('../server/form.cjs');
const {createMailer} = require('../server/mailer.cjs');
const projects = require('../server/projects.cjs');
const emails = require('../server/emails.cjs');

const config = {smtpHost: '', smtpUser: '', smtpPassword: '', mailFrom: '', baseUrl: 'https://example.test'};

function fakeStore(overrides = {}) {
  const calls = [];
  const store = {
    calls,
    sheetName: 'Adatok',
    baseUrl: 'https://example.test',
    async project(uid) {
      return {uid, rowNumber: 2, data: {uid, email: 'client@example.com', status: 'AKTÍV'}};
    },
    async saveMemo(uid, memo) {calls.push(['saveMemo', uid, memo]); return memo;},
    async addNote(uid, note) {calls.push(['addNote', uid, note]); return [];},
    async saveAnswer(uid, code, answer) {calls.push(['saveAnswer', uid, code, answer]);},
    async saveExpectedFiles(uid, paths) {calls.push(['saveExpectedFiles', uid, paths]); return paths;},
    async getConfig() {return '';},
    async setConfig(key, value) {calls.push(['setConfig', key, value]);},
    async setStartDate(uid, date) {calls.push(['setStartDate', uid, date]);},
    clientFormUrl(uid) {return 'https://example.test/form?uid=' + uid;},
    async withLock(key, callback) {return callback();}
  };
  return Object.assign(store, overrides);
}

function dashboardFor(store, overrides = {}) {
  return createDashboard({
    google: {}, store,
    mail: overrides.mail || {async list() {return {configured: true, messages: []};}, async get() {return {};}},
    mailer: createMailer(config), config
  });
}

test('Ismeretlen RPC művelet hibát ad', async () => {
  const dashboard = dashboardFor(fakeStore());
  await assert.rejects(() => dashboard.call('nemLetezik', []), /Ismeretlen dashboard művelet/);
});

test('Memo, jegyzet és elvárt fájlok a store-on keresztül mentődnek', async () => {
  const store = fakeStore();
  const dashboard = dashboardFor(store);
  const original = projects.getDashboardProject;
  projects.getDashboardProject = async (google, store, uid) => ({uid, memo: 'jegyzet'});
  try {
    assert.equal(await dashboard.call('dashboardSaveMemo', ['ABC', 'jegyzet']), 'jegyzet');
    await dashboard.call('dashboardAddNote', ['ABC', 'új']);
    assert.deepEqual(await dashboard.call('dashboardSaveExpectedFiles', ['ABC', 'PDFA/EK-01.pdf']),
      {uid: 'ABC', memo: 'jegyzet'});
  } finally {
    projects.getDashboardProject = original;
  }
  assert.deepEqual(store.calls[0], ['saveMemo', 'ABC', 'jegyzet']);
  assert.deepEqual(store.calls[1], ['addNote', 'ABC', 'új']);
  assert.deepEqual(store.calls[2], ['saveExpectedFiles', 'ABC', 'PDFA/EK-01.pdf']);
});

test('Az AI-kulcs formátumát a szerver ellenőrzi', async () => {
  const store = fakeStore();
  const dashboard = dashboardFor(store);
  await assert.rejects(() => dashboard.call('dashboardConfigureAi', ['short']), /Érvénytelen Gemini API-kulcs/);
  assert.equal(await dashboard.call('dashboardConfigureAi', ['AIzaExampleKeyForLocalTestOnly123456789']), true);
  assert.deepEqual(store.calls.at(-1), ['setConfig', 'GEMINI_API_KEY', 'AIzaExampleKeyForLocalTestOnly123456789']);
});

test('E-mail csak megerősítéssel és érvényes címzettel megy ki', async () => {
  const dashboard = dashboardFor(fakeStore());
  await assert.rejects(() => dashboard.call('dashboardSendEmail', ['ABC', 'intake', '']), /megerősítése/);
  const original = emails.sendProjectEmail;
  emails.sendProjectEmail = async (google, store, mailer, uid, kind, confirmation) => {
    assert.equal(uid, 'ABC'); assert.equal(kind, 'intake'); assert.equal(confirmation, 'email:intake:ABC');
    return 'elküldve';
  };
  try {
    assert.equal(await dashboard.call('dashboardSendEmail', ['ABC', 'intake', 'email:intake:ABC']), 'elküldve');
  } finally {emails.sendProjectEmail = original;}
});

test('Az elküldött levelek listája címzett nélkül jelzi a hiányt', async () => {
  const store = fakeStore({
    async project(uid) {return {uid, rowNumber: 2, data: {uid, email: ''}};}
  });
  const dashboard = dashboardFor(store);
  assert.deepEqual(await dashboard.call('dashboardListSentMail', ['ABC']),
    {configured: true, missingRecipient: true, messages: []});
  await assert.rejects(() => dashboard.call('dashboardGetSentMail', ['ABC', '1:2']), /nincs érvényes e-mail-cím/);
});

test('Az űrlap HTML-be kerül a google.script.run helyettesítő és az UID', () => {
  const html = renderForm('<script>\n// MARK: Kezdőállapot\nconst INITIAL_UID=\'<?= uid ?>\';</script>', 'ABC123');
  assert.match(html, /const INITIAL_UID='ABC123'/);
  assert.match(html, /window\.google=\{script:\{run:runner\(\)\}\}/);
  assert.match(html, /fetch\('\/api\/form'/);
  const escaped = renderForm('<?= uid ?>', '<script>');
  assert.equal(escaped, '&lt;script&gt;');
});

test('Az űrlap API csak az engedélyezett műveleteket fogadja', async () => {
  const calls = [];
  const store = {
    async createRecord() {calls.push('create'); return {success: true, mode: 'created', uid: 'NEW', url: 'u'};},
    async getData(uid) {calls.push('get:' + uid); return {uid};},
    async saveData(data) {calls.push('save:' + data.uid); return {success: true, uid: data.uid};}
  };
  assert.deepEqual(await handleFormRequest(store, {name: 'createNewRecordForWeb', args: []}),
    {success: true, mode: 'created', uid: 'NEW', url: 'u'});
  assert.deepEqual(await handleFormRequest(store, {name: 'getData', args: ['ABC']}), {uid: 'ABC'});
  assert.deepEqual(await handleFormRequest(store, {name: 'saveData', args: [{uid: 'ABC'}]}),
    {success: true, uid: 'ABC'});
  await assert.rejects(() => handleFormRequest(store, {name: 'torles', args: []}), /Érvénytelen űrlapművelet/);
  assert.deepEqual(calls, ['create', 'get:ABC', 'save:ABC']);
});

test('SMTP nélkül a levélküldés érthető hibát ad', async () => {
  const mailer = createMailer(config);
  assert.equal(mailer.configured, false);
  await assert.rejects(() => mailer.send({to: 'a@b.hu', subject: 'x', body: 'y'}), /SMTP-kapcsolat nincs beállítva/);
});

test('A dashboard műveletek továbbítják a paramétereket', async () => {
  const originalPerform = projects.dashboardPerform;
  const originalRestart = projects.restartProject;
  const originalList = projects.dashboardListProjects;
  projects.dashboardPerform = async (google, store, uid, action, confirmation) => ({uid, action, confirmation});
  projects.restartProject = async (google, store, uid, postfix, confirmation) => ({uid, postfix, confirmation});
  projects.dashboardListProjects = async () => [{uid: 'A'}];
  try {
    const dashboard = dashboardFor(fakeStore());
    assert.deepEqual(await dashboard.call('dashboardPerform', ['ABC', 'sync', 'x']),
      {uid: 'ABC', action: 'sync', confirmation: 'x'});
    assert.deepEqual(await dashboard.call('dashboardRestartProject', ['ABC', 'MOD_2609', 'restart:ABC']),
      {uid: 'ABC', postfix: 'MOD_2609', confirmation: 'restart:ABC'});
    assert.deepEqual(await dashboard.call('dashboardListProjects', []), [{uid: 'A'}]);
  } finally {
    projects.dashboardPerform = originalPerform;
    projects.restartProject = originalRestart;
    projects.dashboardListProjects = originalList;
  }
});
