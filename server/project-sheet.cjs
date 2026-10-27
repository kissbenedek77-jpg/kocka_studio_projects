'use strict';
const domain = require('./domain.cjs');

const quote = name => `'${String(name).replace(/'/g, "''")}'`;

function columnIndex(address) {
  const letters = String(address).match(/^[A-Z]+/)[0];
  return letters.split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function findChildFolder(google, parentId, names) {
  const children = await google.listChildren(parentId);
  return children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && names.includes(item.name)) || null;
}

async function findProjectDataSpreadsheet(google, projectFolderId) {
  const root = await google.file(projectFolderId);
  const folders = [root];
  const written = await findChildFolder(google, projectFolderId, ['Írásos', 'írásos']);
  if (written) folders.push(written);
  const matches = [];
  for (const folder of folders) {
    const children = await google.listChildren(folder.id);
    children.filter(item => item.mimeType === 'application/vnd.google-apps.spreadsheet' &&
      /^Tervezési adatok(?:\s|\s*-)/i.test(item.name)).forEach(item => matches.push(item));
  }
  if (matches.length > 1)
    throw new Error('Több „Tervezési adatok” Sheet található a projektmappában.');
  return matches[0] || null;
}

async function ensureProjectDataSpreadsheet(google, projectFolder) {
  const existing = await findProjectDataSpreadsheet(google, projectFolder.id);
  if (existing) return existing;
  const written = await google.ensureFolder(projectFolder.id, 'írásos');
  const file = await google.copyFile(domain.PROJECT_DATA_TEMPLATE_ID,
    'Tervezési adatok - ' + projectFolder.name, written.id);
  return file;
}

async function setCellLinkIn(google, spreadsheetId, sheetName, row, column, text, url) {
  const data = await google.sheets.spreadsheets.get({spreadsheetId, fields: 'sheets.properties'});
  const sheet = (data.data.sheets || []).find(item => item.properties?.title === sheetName);
  if (!sheet) return false;
  await google.batchUpdateIn(spreadsheetId, [{updateCells: {
    start: {sheetId: sheet.properties.sheetId, rowIndex: row - 1, columnIndex: column - 1},
    rows: [{values: [{userEnteredValue: {stringValue: text}, hyperlink: url}]}],
    fields: 'userEnteredValue,hyperlink'
  }}]);
  return true;
}

async function setProjectDashboardLink(google, spreadsheetId, baseUrl, uid) {
  const data = await google.sheets.spreadsheets.get({spreadsheetId, fields: 'sheets.properties'});
  if (!(data.data.sheets || []).some(item => item.properties?.title === 'Generálás')) return;
  const target = baseUrl + '/dashboard?project=' + encodeURIComponent(uid);
  await google.updateIn(spreadsheetId, `${quote('Generálás')}!A6`, [['Projekt dashboard']]);
  await setCellLinkIn(google, spreadsheetId, 'Generálás', 6, 2, 'Dashboard megnyitása', target);
}

async function getTechnicalSheetReplacements(google, spreadsheetId) {
  const values = await google.valuesIn(spreadsheetId, `${quote('Munkalap1')}!A1:J20`);
  const out = {};
  const addresses = ['B2', 'B3', 'B5', 'B6', 'B7', 'E2', 'H2', 'H3', 'H5',
    'H7', 'E6', 'E8', 'B9', 'E9', 'J2', 'J5'];
  addresses.forEach(address => {
    const column = columnIndex(address);
    const row = Number(address.slice(String(address).match(/^[A-Z]+/)[0].length)) - 1;
    out['TERVEZESI_ADATOK:Munkalap1!' + address] = (values[row] || [])[column] || '';
  });
  return out;
}

async function getTechnicalProgramLines(google, spreadsheetId, replacements) {
  const values = await google.valuesIn(spreadsheetId, `${quote('Tervezési program')}!A2:B17`);
  domain.validateTechnicalProgramRows(values);
  return values.map((row, index) =>
    domain.expandTechnicalProgramRow(row, replacements, String.fromCharCode(97 + index)));
}

async function findProjectRoomFile(google, projectFolderId) {
  const folders = [];
  for (const name of ['PLN', 'pln']) {
    const folder = (await google.listChildren(projectFolderId))
      .find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === name);
    if (folder) folders.push(folder);
  }
  if (folders.length > 1) throw new Error('Több PLN mappa található a projektben.');
  if (!folders.length) return null;
  const files = (await google.listChildren(folders[0].id))
    .filter(file => /^(?:helyiségek|helyiséglista)\.txt$/i.test(file.name));
  const preferred = files.filter(file => /^helyiségek\.txt$/i.test(file.name));
  if (preferred.length > 1 || (!preferred.length && files.length > 1))
    throw new Error('Több helyiséglista szövegfájl található a PLN mappában.');
  return preferred[0] || files[0] || null;
}

async function getProjectRoomData(google, projectFolderId) {
  const file = await findProjectRoomFile(google, projectFolderId);
  if (!file) return null;
  const buffer = await google.downloadFile(file.id);
  const parsed = domain.parseProjectRoomText(buffer.toString('utf8'), 'PLN/' + file.name);
  const spreadsheet = await findProjectDataSpreadsheet(google, projectFolderId);
  if (!spreadsheet) throw new Error('A projekt tervezési adatlapja nem található.');
  return {...parsed, spreadsheet, sourceName: 'PLN/' + file.name};
}

async function writeRoomTotalToProjectSheet(google, spreadsheetId, totalCents) {
  const range = `${quote('Munkalap1')}!H7`;
  const previous = await google.valuesIn(spreadsheetId, range);
  const oldValue = Number((previous[0] || [])[0]);
  await google.updateIn(spreadsheetId, range, [[totalCents / 100]]);
  await google.batchUpdateIn(spreadsheetId, [{
    repeatCell: {
      range: {sheetId: await sheetId(google, spreadsheetId, 'Munkalap1'), startRowIndex: 6, endRowIndex: 7,
        startColumnIndex: 7, endColumnIndex: 8},
      cell: {userEnteredFormat: {numberFormat: {type: 'NUMBER', pattern: '0.00'}}},
      fields: 'userEnteredFormat.numberFormat'
    }
  }]).catch(() => {});
  return Number.isFinite(oldValue) && oldValue > 0 ? Math.round(oldValue * 100) : null;
}

async function sheetId(google, spreadsheetId, name) {
  const data = await google.sheets.spreadsheets.get({spreadsheetId, fields: 'sheets.properties'});
  const sheet = (data.data.sheets || []).find(item => item.properties?.title === name);
  return sheet ? sheet.properties.sheetId : null;
}

async function writeRoomListToProjectSheet(google, spreadsheetId, rows) {
  const header = await google.valuesIn(spreadsheetId, `${quote('Munkalap2')}!A1`);
  const first = String((header[0] || [])[0] || '').trim();
  if (first && first !== 'Helyiség') return false;
  const current = await google.valuesIn(spreadsheetId, `${quote('Munkalap2')}!A1:B200`);
  const rowCount = Math.max(current.length, rows.length, 1);
  await google.clearIn(spreadsheetId, `${quote('Munkalap2')}!A1:B${rowCount}`);
  await google.updateIn(spreadsheetId, `${quote('Munkalap2')}!A1`, rows);
  const id = await sheetId(google, spreadsheetId, 'Munkalap2');
  if (id === null) return false;
  const requests = [];
  rows.forEach((row, index) => {
    const emphasized = index === 0 || !row[1] || / összesen$/.test(row[0]) || row[0] === 'Terasz nélkül';
    if (!emphasized) return;
    requests.push({repeatCell: {
      range: {sheetId: id, startRowIndex: index, endRowIndex: index + 1, startColumnIndex: 0, endColumnIndex: 2},
      cell: {userEnteredFormat: {textFormat: {bold: true}}},
      fields: 'userEnteredFormat.textFormat.bold'
    }});
  });
  requests.push({updateDimensionProperties: {
    range: {sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: 1},
    properties: {pixelSize: 210}, fields: 'pixelSize'
  }});
  requests.push({updateDimensionProperties: {
    range: {sheetId: id, dimension: 'COLUMNS', startIndex: 1, endIndex: 2},
    properties: {pixelSize: 80}, fields: 'pixelSize'
  }});
  await google.batchUpdateIn(spreadsheetId, requests);
  return true;
}

async function getProjectPlanEntries(google, projectFolderId, uid, answers = {}) {
  const pdfa = (await google.listChildren(projectFolderId))
    .find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'PDFA');
  if (!pdfa) return [];
  const entries = [];
  (await google.listChildren(pdfa.id)).forEach(file => {
    const name = String(file.name || '');
    if (!/\.pdf$/i.test(name)) return;
    const title = name.replace(/\.pdf$/i, '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!title) return;
    entries.push({title, scale: domain.getPlanScaleForTitle(title) || answers['scale:' + title] || ''});
  });
  return domain.sortPlanEntries(entries);
}

async function getLatestRenderCoverFile(google, projectFolderId) {
  const render = (await google.listChildren(projectFolderId))
    .find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'Render');
  if (!render) return null;
  const images = (await google.listChildren(render.id)).map(file => ({
    id: file.id, name: file.name, mimeType: file.mimeType,
    updatedMs: file.modifiedTime ? Date.parse(file.modifiedTime) : 0
  }));
  return domain.selectCoverImage(images);
}

async function prepareTechnicalProjectSheet(google, projectFolder, baseUrl, uid) {
  const spreadsheet = await ensureProjectDataSpreadsheet(google, projectFolder);
  await setProjectDashboardLink(google, spreadsheet.id, baseUrl, uid);
  const roomData = await getProjectRoomData(google, projectFolder.id);
  if (roomData) {
    const list = domain.buildRoomList(roomData);
    await writeRoomTotalToProjectSheet(google, roomData.spreadsheet.id, list.totalCents);
    await writeRoomListToProjectSheet(google, roomData.spreadsheet.id, list.rows);
  }
  return spreadsheet;
}

module.exports = {
  findProjectDataSpreadsheet, ensureProjectDataSpreadsheet, setProjectDashboardLink,
  getTechnicalSheetReplacements, getTechnicalProgramLines,
  findProjectRoomFile, getProjectRoomData,
  writeRoomTotalToProjectSheet, writeRoomListToProjectSheet,
  getProjectPlanEntries, getLatestRenderCoverFile, prepareTechnicalProjectSheet
};
