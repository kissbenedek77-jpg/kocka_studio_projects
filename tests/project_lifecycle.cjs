'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const projects = require('../server/projects.cjs');
const projectSheet = require('../server/project-sheet.cjs');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const WORK_ID = 'work00000001';
const PREP_ID = 'prep00000001';

function createDrive() {
  const nodes = new Map();
  function add(id, name, mimeType, parentId) {
    nodes.set(id, {id, name, mimeType, parents: parentId ? [parentId] : [],
      webViewLink: 'https://drive.google.com/drive/folders/' + id});
    return nodes.get(id);
  }
  add(WORK_ID, 'Projektek', FOLDER_MIME, null);
  add(PREP_ID, '_Ajánlatok', FOLDER_MIME, WORK_ID);
  add(domain.TEMPLATE_ROOT_FOLDER_ID, 'Sablonok', FOLDER_MIME, PREP_ID);
  return {nodes, add};
}

function createGoogle(drive, events, statuses) {
  let sequence = 1;
  function children(parentId) {
    return [...drive.nodes.values()].filter(node => (node.parents || [])[0] === parentId);
  }
  return {
    async file(id) {
      const node = drive.nodes.get(id);
      if (!node) throw new Error('Nincs ilyen fájl: ' + id);
      return node;
    },
    async listChildren(parentId) {return children(parentId);},
    async createFolder(parentId, name) {
      const node = drive.add('new' + sequence++, name, FOLDER_MIME, parentId);
      events.push('create:' + name);
      return node;
    },
    async ensureFolder(parentId, name) {
      return children(parentId).find(node => node.name === name && node.mimeType === FOLDER_MIME) ||
        this.createFolder(parentId, name);
    },
    async copyFile(fileId, name, parentId) {
      return drive.add('copy' + sequence++, name, 'application/vnd.google-apps.spreadsheet', parentId);
    },
    async moveFile(fileId, addParents) {
      const node = drive.nodes.get(fileId);
      node.parents = [addParents];
      events.push('move:' + node.name);
      return node;
    },
    async update(range, rows) {
      statuses.push({range, value: rows[0][0]});
    },
    async setCellLink(rowNumber, column, text, url) {
      const project = drive.nodes.get('project0001');
      if (project) project.webViewLink = url;
    },
    async values() {return [];},
    async valuesIn() {return [];},
    async updateIn() {},
    async batchUpdateIn() {},
    async sheetRows() {return [];},
    async appendSheet() {},
    async updateSheetRow() {},
    sheets: {spreadsheets: {get: async () => ({data: {sheets: []}})}}
  };
}

function createStore() {
  const state = {started: false, uid: 'TEST-UID'};
  return {
    state,
    sheetName: 'Adatok',
    baseUrl: 'https://example.test',
    async project(uid) {
      return {uid, rowNumber: 2, data: {
        uid, vezeteknev: 'Kiss', keresztnev: 'Anna',
        projekt_varos: 'Magyaratád', projekt_kozterulet: 'Kossuth', projekt_tipus: 'utca', projekt_hazszam: '531',
        projektTipus: 'Családi ház', projektCim: 'Magyaratád 531', status: 'ELŐKÉSZÍTÉS'
      }};
    },
    async getFolderUrl() {
      return 'https://drive.google.com/drive/folders/project0001';
    },
    async getDocumentRecords() {return [{row: 2, uid: state.uid, type: 'ajanlat', id: 'doc1', status: 'DRAFT'}];},
    async getExpectedFiles() {return '';},
    async getRestartPostfix() {return '';},
    async getStartDate() {return '';},
    async getAnswers() {return {};},
    async getConfig() {return '';},
    async markStarted() {state.started = true;},
    clientFormUrl(uid) {return 'https://example.test/form?uid=' + uid;},
    async withLock(key, callback) {return callback();}
  };
}

function createHooks(events) {
  const calls = {finalize: 0, generate: 0, written: 0};
  return {
    calls,
    getDashboardProject: async uid => ({
      uid, stage: 'started', issues: [],
      documents: [{type: 'muszakiLeiras', url: 'https://docs.google.com/document/d/test'}]
    }),
    documents: {
      finalizableRecords(records) {return records.filter(record => record.type === 'ajanlat');},
      async finalizeProjectDocuments() {calls.finalize++; events.push('finalize'); return {finalized: 1};},
      async generateDocument() {calls.generate++; events.push('generate'); return {created: true, url: 'https://docs.google.com/document/d/test'};},
      async finalizeWrittenDocuments() {calls.written++; events.push('written');},
      async syncProjectByUid() {}
    },
    projectSheet
  };
}

function buildProject(drive, name) {
  const project = drive.add('project0001', name, FOLDER_MIME, PREP_ID);
  drive.add('written0001', 'írásos', FOLDER_MIME, project.id);
  drive.add('internal0001', '_Belső', FOLDER_MIME, project.id);
  return project;
}

test('Az indítás csak megerősítés után, a véglegesítés után mozgat', async () => {
  const drive = createDrive();
  const project = buildProject(drive, 'Magyaratád Kossuth utca 531');
  const events = [], statuses = [];
  const google = createGoogle(drive, events, statuses);
  const store = createStore();
  const hooks = createHooks(events);

  await assert.rejects(() => projects.dashboardPerform(google, store, 'TEST-UID', 'start', 'NO', hooks),
    /megerősítése/);
  assert.equal(project.parents[0], PREP_ID);

  const result = await projects.dashboardPerform(google, store, 'TEST-UID', 'start', 'start:TEST-UID', hooks);
  assert.equal(hooks.calls.finalize, 1);
  assert.equal(hooks.calls.generate, 2);
  assert.equal(project.parents[0], WORK_ID, 'Az indítás a munka mappába mozgat');
  assert.ok(events.indexOf('finalize') < events.indexOf('move:Magyaratád Kossuth utca 531'));
  assert.deepEqual(statuses.at(-1), {range: "'Adatok'!C2", value: 'AKTÍV'});
  assert.equal(store.state.started, true);
  assert.equal(result.message, 'A projekt elindult; 1 dokumentum véglegesítve.');
});

test('Névütközéskor a projekt helyben marad és nincs véglegesítés', async () => {
  const drive = createDrive();
  const project = buildProject(drive, 'Ütköző projekt');
  drive.add('conflict0001', 'Ütköző projekt', FOLDER_MIME, WORK_ID);
  const events = [], statuses = [];
  const google = createGoogle(drive, events, statuses);
  const store = createStore();
  const hooks = createHooks(events);

  await assert.rejects(() => projects.dashboardPerform(google, store, 'TEST-UID', 'start', 'start:TEST-UID', hooks),
    /már van ilyen nevű projektmappa/);
  assert.equal(project.parents[0], PREP_ID);
  assert.equal(hooks.calls.finalize, 0, 'Névütközéskor nincs részleges véglegesítés');
});

test('A lezárás csak megerősítés után mozgat az _Elkészült mappába', async () => {
  const drive = createDrive();
  const project = drive.add('project0001', 'Kész projekt', FOLDER_MIME, WORK_ID);
  drive.add('written0001', 'írásos', FOLDER_MIME, project.id);
  const events = [], statuses = [];
  const google = createGoogle(drive, events, statuses);
  const store = createStore();
  const hooks = createHooks(events);

  await assert.rejects(() => projects.dashboardPerform(google, store, 'TEST-UID', 'close', 'NO', hooks),
    /megerősítése/);
  assert.equal(project.parents[0], WORK_ID);

  await projects.dashboardPerform(google, store, 'TEST-UID', 'close', 'close:TEST-UID', hooks);
  assert.equal(hooks.calls.written, 1);
  const archive = [...drive.nodes.values()].find(node => node.name === '_Elkészült');
  assert.ok(archive, 'Az archív mappa létrejön');
  assert.equal(archive.parents[0], WORK_ID, 'Az archívum az aktív projektek alatt van');
  assert.equal(project.parents[0], archive.id);
  assert.equal(statuses.at(-1).value, 'KÉSZ');
});

test('Ismeretlen művelet és hiányzó dokumentumtípus hibát ad', async () => {
  const drive = createDrive();
  buildProject(drive, 'Projekt');
  const google = createGoogle(drive, [], []);
  const store = createStore();
  const hooks = createHooks([]);
  await assert.rejects(() => projects.dashboardPerform(google, store, 'TEST-UID', 'ismeretlen', '', hooks),
    /Ismeretlen projektművelet/);
  await assert.rejects(() => projects.dashboardPerform(google, store, 'TEST-UID', 'document:unknown', '', hooks),
    /Ismeretlen dokumentumtípus/);
});
