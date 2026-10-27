'use strict';
const crypto = require('node:crypto');
const domain = require('./domain.cjs');

const SHEETS = {
  memo: '_ProjektMemo',
  notes: '_ProjektJegyzetek',
  restarts: '_ProjektÚjraindítás',
  checks: '_ProjektEllenőrzés',
  expected: '_ProjektElvártFájlok',
  timeline: '_ProjektIdővonal',
  documents: '_DokumentumIndex',
  settings: '_ProjektBeállítások'
};

const HEADERS = {
  memo: ['UID', 'Jegyzet', 'Módosítva'],
  notes: ['UID', 'Időpont', 'Jegyzet'],
  restarts: ['UID', 'Forrás UID', 'Utótag', 'Időpont'],
  checks: ['UID', 'Ellenőrzés', 'Válasz', 'Időpont'],
  expected: ['UID', 'Relatív fájlútvonalak', 'Módosítva'],
  timeline: ['UID', 'Indítás időpontja'],
  documents: ['UID', 'Típus', 'Dokumentum ID', 'Állapot', 'Utolsó szinkron'],
  settings: ['Kulcs', 'Érték']
};

const locks = new Map();
async function withLock(key, callback) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => {release = resolve;});
  locks.set(key, previous.then(() => current));
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function createStore(config, google) {
  const quote = name => `'${String(name).replace(/'/g, "''")}'`;
  const book = config.sheetId;

  function clientFormUrl(uid) {
    return `${config.baseUrl}/form?uid=${encodeURIComponent(uid)}`;
  }

  async function allProjectRows() {
    return google.allRows();
  }

  async function findRowNumber(uid) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!normalized) return -1;
    const item = (await allProjectRows()).find(entry => String(entry.row[0]).trim().toUpperCase() === normalized);
    return item ? item.rowNumber : -1;
  }

  async function project(uid) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) throw new Error('Érvénytelen projektazonosító.');
    const item = (await allProjectRows()).find(entry => String(entry.row[0]).trim().toUpperCase() === normalized);
    if (!item) throw new Error('A projekt nem található.');
    return {row: item.row, rowNumber: item.rowNumber, data: domain.rowToData(item.row), uid: normalized};
  }

  async function generateUniqueUid() {
    const existing = new Set((await allProjectRows()).map(item => String(item.row[0]).trim().toUpperCase()));
    let uid;
    do {
      uid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    } while (existing.has(uid));
    return uid;
  }

  async function appendProjectRow(data, uid) {
    const row = domain.buildRow(data, uid);
    await google.append(`${quote(config.sheetName)}!A1`, [row]);
    return (await findRowNumber(uid));
  }

  async function updateProjectRow(rowNumber, data, uid) {
    const row = domain.buildRow(data, uid);
    await google.update(`${quote(config.sheetName)}!A${rowNumber}:AN${rowNumber}`, [row]);
  }

  async function getFolderUrl(rowNumber) {
    const link = await google.cellLink(rowNumber, 5);
    if (link) return link;
    const row = (await google.values(`${quote(config.sheetName)}!E${rowNumber}`))[0] || [];
    return String(row[0] || '');
  }

  async function createRecord() {
    const uid = await generateUniqueUid();
    const url = clientFormUrl(uid);
    await appendProjectRow({status: 'ELŐKÉSZÍTÉS', clientLink: url, gdprAccepted: false}, uid);
    return {success: true, mode: 'created', uid, url};
  }

  async function getData(uid) {
    if (!uid) return null;
    const normalized = String(uid).trim().toUpperCase();
    let item;
    try {
      item = await project(normalized);
    } catch (_) {
      return null;
    }
    const data = Object.assign({}, item.data, {
      uid: item.data.uid,
      szuletesiIdo: domain.formatDate(item.data.szuletesiIdo),
      ertesitesi_same: String(item.data.lakcim || '') === String(item.data.ertesitesiCim || '')
    });
    return data;
  }

  async function saveData(input) {
    domain.validateData(input);
    let uid = input.uid ? String(input.uid).trim().toUpperCase() : '';
    let rowNumber = -1;
    if (uid) {
      rowNumber = await findRowNumber(uid);
      if (rowNumber === -1) throw new Error('A megadott UID nem található. Új rekord létrehozása nem engedélyezett.');
    } else {
      uid = await generateUniqueUid();
    }
    const data = Object.assign({}, input);
    let oldStatus = '';
    let oldClientLink = '';
    let oldGdprAccepted = false;
    let oldProjectFolderUrl = '';
    if (rowNumber !== -1) {
      const oldRow = ((await google.values(`${quote(config.sheetName)}!A${rowNumber}:AN${rowNumber}`))[0]) || [];
      oldStatus = oldRow[2] || '';
      oldClientLink = oldRow[3] || '';
      oldGdprAccepted = oldRow[6] === true || oldRow[6] === 'TRUE';
      oldProjectFolderUrl = await getFolderUrl(rowNumber);
    }
    data.status = data.status || oldStatus || 'ELŐKÉSZÍTÉS';
    data.clientLink = data.clientLink || oldClientLink || clientFormUrl(uid);
    data.projectFolderUrl = data.projectFolderUrl || oldProjectFolderUrl || '';
    data.gdprAccepted = data.gdprAccepted === true || oldGdprAccepted;
    domain.applyNotificationAddress(data);
    if (rowNumber === -1) {
      rowNumber = await appendProjectRow(data, uid);
      return {success: true, mode: 'created', uid, url: data.clientLink, rowNumber};
    }
    await updateProjectRow(rowNumber, data, uid);
    if (oldProjectFolderUrl && domain.extractDriveId(oldProjectFolderUrl))
      await google.setCellLink(rowNumber, 5, 'Projekt mappa', oldProjectFolderUrl);
    return {success: true, mode: 'updated', uid, url: data.clientLink, rowNumber};
  }

  async function sheetRows(name) {
    return google.sheetRows(name);
  }

  async function rowsByUid(name, uid) {
    return (await sheetRows(name)).filter(row => String(row[0]) === String(uid));
  }

  async function getMemo(uid) {
    const current = (await rowsByUid(SHEETS.memo, uid))[0];
    if (current) return String(current[1] || '');
    return (await getNotes(uid)).map(note => (note.at ? '[' + note.at + ']\n' : '') + note.text).join('\n\n');
  }

  async function saveMemo(uid, memo) {
    memo = String(memo || '');
    if (memo.length > 50000) throw new Error('A jegyzet legfeljebb 50 000 karakter lehet.');
    const rows = await sheetRows(SHEETS.memo);
    const index = rows.findIndex(row => String(row[0]) === String(uid));
    if (index < 0) await google.appendSheet(SHEETS.memo, HEADERS.memo, [uid, memo, new Date()]);
    else await google.updateSheetRow(SHEETS.memo, index + 2, [uid, memo, new Date()]);
    return memo;
  }

  async function getNotes(uid) {
    return (await rowsByUid(SHEETS.notes, uid)).map(row => ({
      at: domain.formatDate(row[1]), text: String(row[2] || '')
    }));
  }

  async function addNote(uid, note) {
    note = String(note || '').trim();
    if (!note || note.length > 10000) throw new Error('A jegyzet 1–10000 karakter lehet.');
    await google.appendSheet(SHEETS.notes, HEADERS.notes, [uid, new Date(), note]);
    return getNotes(uid);
  }

  async function getRestartPostfix(uid) {
    const row = (await rowsByUid(SHEETS.restarts, uid))[0];
    return row ? String(row[2] || '') : '';
  }

  async function addRestart(newUid, sourceUid, postfix) {
    await google.appendSheet(SHEETS.restarts, HEADERS.restarts, [newUid, sourceUid, postfix, new Date()]);
  }

  async function getExpectedFiles(uid) {
    const row = (await rowsByUid(SHEETS.expected, uid))[0];
    return row ? String(row[1] || '') : '';
  }

  async function saveExpectedFiles(uid, paths) {
    const lines = String(paths || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 200 || lines.join('\n').length > 12000)
      throw new Error('Legfeljebb 200 elvárt fájl adható meg.');
    lines.forEach(line => {
      if (line.indexOf('..') !== -1 || line.charAt(0) === '/' || /[\x00-\x1f]/.test(line))
        throw new Error('Érvénytelen relatív fájlútvonal: ' + line);
    });
    const rows = await sheetRows(SHEETS.expected);
    const index = rows.findIndex(row => String(row[0]) === String(uid));
    const value = lines.join('\n');
    if (index < 0) await google.appendSheet(SHEETS.expected, HEADERS.expected, [uid, value, new Date()]);
    else await google.updateSheetRow(SHEETS.expected, index + 2, [uid, value, new Date()]);
    return value;
  }

  async function getStartDate(uid) {
    const row = (await rowsByUid(SHEETS.timeline, uid))[0];
    if (!row || !row[1]) return '';
    const text = String(row[1]).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3] + 'T12:00:00.000Z';
    const hu = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (hu) return hu[1] + '-' + String(hu[2]).padStart(2, '0') + '-' + String(hu[3]).padStart(2, '0') + 'T12:00:00.000Z';
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  async function setStartDate(uid, dateText) {
    const date = new Date(dateText + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== dateText ||
        dateText > domain.todayInBudapest())
      throw new Error('Az indítási dátum nem lehet hibás vagy jövőbeli.');
    const rows = await sheetRows(SHEETS.timeline);
    const index = rows.findIndex(row => String(row[0]) === String(uid));
    if (index < 0) await google.appendSheet(SHEETS.timeline, HEADERS.timeline, [uid, dateText]);
    else await google.updateSheetRow(SHEETS.timeline, index + 2, [uid, dateText]);
  }

  async function markStarted(uid) {
    if (await getStartDate(uid)) return;
    await google.appendSheet(SHEETS.timeline, HEADERS.timeline, [uid, domain.todayInBudapest()]);
  }

  async function getAnswers(uid) {
    const answers = {};
    (await rowsByUid(SHEETS.checks, uid)).forEach(row => {
      answers[String(row[1])] = String(row[2] || '');
    });
    return answers;
  }

  async function saveAnswer(uid, code, answer) {
    await google.appendSheet(SHEETS.checks, HEADERS.checks, [uid, code, answer, new Date()]);
  }

  async function getDocumentRecords(uid) {
    return (await sheetRows(SHEETS.documents))
      .map((row, index) => ({
        row: index + 2, uid: String(row[0]), type: String(row[1]), id: String(row[2]),
        status: String(row[3]), syncedAt: row[4] || ''
      }))
      .filter(record => record.uid === String(uid));
  }

  async function registerDocument(uid, type, id) {
    const old = (await getDocumentRecords(uid)).filter(record => record.type === type)[0];
    if (old) {
      if (old.id !== id && old.status === 'FINAL')
        throw new Error('Véglegesített dokumentum nem cserélhető: ' + type);
      if (old.id !== id) await google.updateSheetRow(SHEETS.documents, old.row, [uid, type, id, old.status, old.syncedAt]);
      return;
    }
    await google.appendSheet(SHEETS.documents, HEADERS.documents, [uid, type, id, 'DRAFT', new Date()]);
  }

  async function setDocumentStatus(record, status) {
    await google.updateSheetRow(SHEETS.documents, record.row,
      [record.uid, record.type, record.id, status, new Date()]);
  }

  async function touchDocument(record) {
    await google.updateSheetRow(SHEETS.documents, record.row,
      [record.uid, record.type, record.id, record.status, new Date()]);
  }

  async function getConfig(key) {
    const row = (await sheetRows(SHEETS.settings)).find(item => String(item[0]) === String(key));
    return row ? String(row[1] || '') : '';
  }

  async function setConfig(key, value) {
    const rows = await sheetRows(SHEETS.settings);
    const index = rows.findIndex(row => String(row[0]) === String(key));
    if (index < 0) await google.appendSheet(SHEETS.settings, HEADERS.settings, [key, value]);
    else await google.updateSheetRow(SHEETS.settings, index + 2, [key, value]);
  }

  async function getAdditionalMergeFields(uid, rowNumber) {
    const headerRows = await google.values(`${quote(config.sheetName)}!A1:BZ1`);
    const headers = headerRows[0] || [];
    if (headers.length <= 40) return {};
    const valueRows = await google.values(`${quote(config.sheetName)}!A${rowNumber}:BZ${rowNumber}`);
    const values = valueRows[0] || [];
    const out = {};
    for (let index = 40; index < headers.length; index++) {
      const header = String(headers[index] || '').trim();
      if (header && !(header in out)) out[header] = values[index] || '';
    }
    return out;
  }

  return {
    SHEETS, HEADERS, clientFormUrl, allProjectRows, findRowNumber, project,
    generateUniqueUid, appendProjectRow, updateProjectRow, getFolderUrl,
    createRecord, getData, saveData,
    getMemo, saveMemo, getNotes, addNote, getRestartPostfix, addRestart,
    getExpectedFiles, saveExpectedFiles,
    getStartDate, setStartDate, markStarted,
    getAnswers, saveAnswer,
    getDocumentRecords, registerDocument, setDocumentStatus, touchDocument,
    getConfig, setConfig, getAdditionalMergeFields,
    withLock, baseUrl: config.baseUrl, sheetName: config.sheetName, geminiApiKey: config.geminiApiKey || ''
  };
}

module.exports = {createStore, withLock, SHEETS, HEADERS};
