'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const {createStore} = require('../server/store.cjs');

const config = {
  baseUrl: 'https://example.test', sheetId: 'SHEET', sheetName: 'Adatok',
  geminiApiKey: ''
};

function fakeGoogle(initialRows) {
  const state = {
    rows: initialRows.map((row, index) => ({row: row.slice(), rowNumber: index + 2})),
    appended: [], updated: [], links: [], sheets: {}
  };
  return {
    state,
    async allRows() {return state.rows.map(item => ({row: item.row.slice(), rowNumber: item.rowNumber}));},
    async values(range) {
      const match = String(range).match(/!A(\d+):AN(\d+)/);
      if (!match) {
        const single = String(range).match(/!E(\d+)/);
        if (single) {
          const item = state.rows.find(row => row.rowNumber === Number(single[1]));
          return item ? [[item.row[4]]] : [];
        }
        return [];
      }
      const item = state.rows.find(row => row.rowNumber === Number(match[1]));
      return item ? [item.row.slice()] : [];
    },
    async cellLink() {return '';},
    async append(range, rows) {
      state.appended.push(rows[0].slice());
      state.rows.push({row: rows[0].slice(), rowNumber: state.rows.length + 2});
    },
    async update(range, rows) {
      const match = String(range).match(/!A(\d+)/);
      state.updated.push({rowNumber: Number(match[1]), values: rows[0].slice()});
    },
    async setCellLink(rowNumber, column, text, url) {state.links.push({rowNumber, column, url});},
    async sheetRows(name) {return (state.sheets[name] || []).map(row => row.slice());},
    async appendSheet(name, headers, row) {
      state.sheets[name] = state.sheets[name] || [];
      state.sheets[name].push(row.slice());
    },
    async updateSheetRow(name, rowNumber, values) {
      state.sheets[name][rowNumber - 2] = values.slice();
    }
  };
}

function rowFor(uid, overrides = {}) {
  const row = domain.buildRow(Object.assign({status: 'AKTÍV', gdprAccepted: true}, overrides), uid);
  return row;
}

test('Meglévő UID csak módosít, a státuszt, linket és GDPR-t megtartja', async () => {
  const row = rowFor('ABC123', {
    clientLink: 'https://example.test/form?uid=ABC123',
    projectFolderUrl: 'https://drive.google.com/drive/folders/folder123456',
    lakcim_irsz: '1055', lakcim_varos: 'Budapest', lakcim_kozterulet: 'Falk Miksa',
    lakcim_tipus: 'utca', lakcim_hazszam: '9', lakcim: '1055 Budapest, Falk Miksa utca 9.'
  });
  const google = fakeGoogle([row]);
  const store = createStore(config, google);
  const result = await store.saveData({
    uid: 'abc123', vezeteknev: 'Kiss', keresztnev: 'Anna', allampolgarsag: 'Magyar',
    adoazonosito: '1234567890', projektTipus: 'Családi ház', ertesitesi_same: true,
    lakcim_irsz: '1055', lakcim_varos: 'Budapest', lakcim_kozterulet: 'Falk Miksa',
    lakcim_tipus: 'utca', lakcim_hazszam: '9', lakcim: '1055 Budapest, Falk Miksa utca 9.'
  });
  assert.equal(result.mode, 'updated');
  assert.equal(google.state.appended.length, 0);
  assert.equal(google.state.updated.length, 1);
  const updated = google.state.updated[0].values;
  assert.equal(updated[0], 'ABC123');
  assert.equal(updated[2], 'AKTÍV', 'A státusz megmarad');
  assert.equal(updated[3], 'https://example.test/form?uid=ABC123', 'A form link megmarad');
  assert.equal(updated[6], true, 'A GDPR elfogadás megmarad');
  assert.equal(updated[18], '1055', 'Az értesítési irányítószám a lakcímből jön');
  assert.equal(updated[24], '1055 Budapest, Falk Miksa utca 9.');
  assert.equal(updated[7], 'Kiss');
  assert.equal(google.state.links[0].url, 'https://drive.google.com/drive/folders/folder123456');
});

test('Ismeretlen UID nem hoz létre rekordot', async () => {
  const google = fakeGoogle([]);
  const store = createStore(config, google);
  await assert.rejects(() => store.saveData({uid: 'NOPE1234', vezeteknev: 'Kiss', keresztnev: 'Anna',
    allampolgarsag: 'Magyar', adoazonosito: '1234567890', projektTipus: 'Családi ház'}),
    /nem található/);
  assert.equal(google.state.appended.length, 0);
});

test('UID nélkül új rekord jön létre a szerveroldali form linkkel', async () => {
  const google = fakeGoogle([]);
  const store = createStore(config, google);
  const result = await store.saveData({vezeteknev: 'Kiss', keresztnev: 'Anna', allampolgarsag: 'Magyar',
    adoazonosito: '1234567890', projektTipus: 'Egyéb', projektTipusEgyeb: 'felújítás'});
  assert.equal(result.mode, 'created');
  assert.match(result.uid, /^[0-9A-F]{32}$/);
  assert.equal(google.state.appended.length, 1);
  const row = google.state.appended[0];
  assert.equal(row.length, domain.FIELDS.length);
  assert.equal(row[2], 'ELŐKÉSZÍTÉS');
  assert.equal(row[3], 'https://example.test/form?uid=' + result.uid);
  assert.equal(row[31], 'Egyéb: felújítás');
});

test('Az űrlap betöltése a meglévő adatokat adja vissza', async () => {
  const row = rowFor('ABC123', {vezeteknev: 'Kiss', keresztnev: 'Anna', szuletesiIdo: '1980-01-02'});
  const google = fakeGoogle([row]);
  const store = createStore(config, google);
  const data = await store.getData('ABC123');
  assert.equal(data.vezeteknev, 'Kiss');
  assert.equal(domain.rowToData(row).szuletesiIdo, '1980-01-02');
  assert.equal(await store.getData('NOPE1234'), null);
});

test('Az indítási dátum csak érvényes, nem jövőbeli nap lehet', async () => {
  const google = fakeGoogle([]);
  const store = createStore(config, google);
  await assert.rejects(() => store.setStartDate('ABC', '2026-02-30'), /hibás|jövőbeli/);
  await assert.rejects(() => store.setStartDate('ABC', '2999-01-01'), /jövőbeli/);
  await store.setStartDate('ABC', '2026-09-01');
  assert.deepEqual(google.state.sheets._ProjektIdővonal[0], ['ABC', '2026-09-01']);
  assert.equal(await store.getStartDate('ABC'), '2026-09-01T12:00:00.000Z');
  await store.setStartDate('ABC', '2026-09-02');
  assert.deepEqual(google.state.sheets._ProjektIdővonal[0], ['ABC', '2026-09-02']);
});

test('Az elvárt fájllista csak biztonságos relatív útvonalakat fogad el', async () => {
  const google = fakeGoogle([]);
  const store = createStore(config, google);
  await assert.rejects(() => store.saveExpectedFiles('ABC', '../titok.pdf'), /Érvénytelen relatív fájlútvonal/);
  await assert.rejects(() => store.saveExpectedFiles('ABC', '/abszolút.pdf'), /Érvénytelen relatív fájlútvonal/);
  const saved = await store.saveExpectedFiles('ABC', 'PDFA/EK-01.pdf\nírásos/szerződés.pdf');
  assert.equal(saved, 'PDFA/EK-01.pdf\nírásos/szerződés.pdf');
  assert.equal(await store.getExpectedFiles('ABC'), 'PDFA/EK-01.pdf\nírásos/szerződés.pdf');
});
