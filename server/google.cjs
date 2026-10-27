'use strict';
const {Readable} = require('node:stream');
const {google} = require('googleapis');
const {rowToData, projectFromRow, extractDriveId, isClosedStatus} = require('./domain.cjs');

function extractFolderLinks(sheetsData) {
  const links = new Map();
  for (const sheet of sheetsData || []) {
    for (const grid of sheet.data || []) {
      (grid.rowData || []).forEach((item, index) => {
        const cell = item.values?.[0];
        const href = cell?.hyperlink || cell?.textFormatRuns?.find(run => run.format?.link?.uri)?.format.link.uri;
        if (href) links.set((grid.startRow || 0) + index + 1, href);
      });
    }
  }
  return links;
}

function googleClient(config, refreshToken = '') {
  const oauth = new google.auth.OAuth2(config.clientId, config.clientSecret, `${config.baseUrl}/auth/callback`);
  if (refreshToken) oauth.setCredentials({refresh_token: refreshToken});
  const sheets = google.sheets({version: 'v4', auth: oauth});
  const drive = google.drive({version: 'v3', auth: oauth});
  const docs = google.docs({version: 'v1', auth: oauth});
  const book = config.sheetId;
  const quote = name => `'${String(name).replace(/'/g, "''")}'`;

  async function valuesIn(spreadsheetId, range, valueRenderOption = 'FORMATTED_VALUE') {
    const result = await sheets.spreadsheets.values.get({spreadsheetId, range, valueRenderOption});
    return result.data.values || [];
  }

  async function updateIn(spreadsheetId, range, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: {values: rows}
    });
  }

  async function appendIn(spreadsheetId, range, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({
      spreadsheetId, range, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: {values: rows}
    });
  }

  async function clearIn(spreadsheetId, range) {
    await sheets.spreadsheets.values.clear({spreadsheetId, range});
  }

  async function batchUpdateIn(spreadsheetId, requests) {
    if (!requests.length) return null;
    return (await sheets.spreadsheets.batchUpdate({
      spreadsheetId, requestBody: {requests}
    })).data;
  }

  async function values(range) {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: book, range, valueRenderOption: 'FORMATTED_VALUE'
    });
    return result.data.values || [];
  }

  async function batchGet(ranges) {
    if (!ranges.length) return [];
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: book, ranges, valueRenderOption: 'FORMATTED_VALUE'
    });
    return (result.data.valueRanges || []).map(item => item.values || []);
  }

  async function update(range, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId: book, range, valueInputOption: 'USER_ENTERED',
      requestBody: {values: rows}
    });
  }

  async function append(range, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({
      spreadsheetId: book, range, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: {values: rows}
    });
  }

  async function clear(range) {
    await sheets.spreadsheets.values.clear({spreadsheetId: book, range});
  }

  async function spreadsheet() {
    const result = await sheets.spreadsheets.get({spreadsheetId: book, fields: 'sheets.properties'});
    return result.data;
  }

  async function getSheetId(name) {
    const data = await spreadsheet();
    const sheet = (data.sheets || []).find(item => item.properties?.title === name);
    return sheet ? sheet.properties.sheetId : null;
  }

  async function ensureSheet(name, headers = []) {
    let id = await getSheetId(name);
    if (id === null) {
      const result = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: book,
        requestBody: {requests: [{addSheet: {properties: {title: name}}}]}
      });
      id = result.data.replies[0].addSheet.properties.sheetId;
      if (headers.length) await update(`${quote(name)}!A1`, [headers]);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: book,
        requestBody: {requests: [{updateSheetProperties: {properties: {sheetId: id, hidden: true}, fields: 'hidden'}}]}
      });
    }
    return id;
  }

  async function sheetRows(name) {
    const id = await getSheetId(name);
    if (id === null) return [];
    const data = await values(`${quote(name)}!A1:ZZ`);
    return data.length > 1 ? data.slice(1) : [];
  }

  async function appendSheet(name, headers, row) {
    await ensureSheet(name, headers);
    await append(`${quote(name)}!A1`, [row]);
  }

  async function updateSheetRow(name, rowNumber, valuesToWrite) {
    await update(`${quote(name)}!A${rowNumber}`, [valuesToWrite]);
  }

  async function cellLink(rowNumber, column) {
    let letters = '';
    for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
      letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
    const result = await sheets.spreadsheets.get({
      spreadsheetId: book,
      ranges: [`${quote(config.sheetName)}!${letters}${rowNumber}`],
      includeGridData: true,
      fields: 'sheets(data(rowData(values(hyperlink,textFormatRuns))))'
    });
    const cell = result.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0];
    return cell?.hyperlink || cell?.textFormatRuns?.find(run => run.format?.link?.uri)?.format.link.uri || '';
  }

  async function setCellLink(rowNumber, column, text, url) {
    const sheetId = await getSheetId(config.sheetName);
    if (sheetId === null) throw new Error('Az Adatok munkalap nem található.');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: book,
      requestBody: {requests: [{updateCells: {
        start: {sheetId, rowIndex: rowNumber - 1, columnIndex: column - 1},
        rows: [{values: [{userEnteredValue: {stringValue: text}, hyperlink: url}]}],
        fields: 'userEnteredValue,hyperlink'
      }}]}
    });
  }

  async function allRows() {
    const [rowsResult, linksResult] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: book, range: `${quote(config.sheetName)}!A2:BM`, valueRenderOption: 'FORMATTED_VALUE'
      }),
      sheets.spreadsheets.get({
        spreadsheetId: book, ranges: [`${quote(config.sheetName)}!E2:E`], includeGridData: true,
        fields: 'sheets(data(startRow,rowData(values(hyperlink,textFormatRuns))))'
      })
    ]);
    const rows = rowsResult.data.values || [];
    const links = extractFolderLinks(linksResult.data.sheets);
    return rows.map((row, index) => {
      const rowNumber = index + 2;
      if (links.has(rowNumber)) row[4] = links.get(rowNumber);
      return {row, rowNumber};
    }).filter(item => String(item.row[0] || '').trim());
  }

  async function project(uid) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) throw new Error('Érvénytelen projektazonosító.');
    const item = (await allRows()).find(entry => String(entry.row[0]).trim().toUpperCase() === normalized);
    if (!item) throw new Error('A projekt nem található.');
    return {...item, data: rowToData(item.row)};
  }

  async function file(id) {
    return (await drive.files.get({
      fileId: id, fields: 'id,name,mimeType,webViewLink,parents,modifiedTime,size',
      supportsAllDrives: true
    })).data;
  }

  async function listChildren(parentId, limit = 3000) {
    const files = [];
    let pageToken;
    do {
      const result = (await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,webViewLink,parents,modifiedTime,size)',
        pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true
      })).data;
      files.push(...result.files || []);
      pageToken = result.nextPageToken;
    } while (pageToken && files.length < limit);
    return files;
  }

  async function findChild(parentId, name, mimeType = '') {
    const children = await listChildren(parentId);
    return children.find(item => item.name === name && (!mimeType || item.mimeType === mimeType)) || null;
  }

  async function createFolder(parentId, name) {
    const result = await drive.files.create({
      requestBody: {name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId]},
      fields: 'id,name,mimeType,webViewLink,parents', supportsAllDrives: true
    });
    return result.data;
  }

  async function ensureFolder(parentId, name) {
    return await findChild(parentId, name, 'application/vnd.google-apps.folder') || await createFolder(parentId, name);
  }

  async function copyFile(fileId, name, parentId) {
    const result = await drive.files.copy({
      fileId, requestBody: {name, parents: [parentId]},
      fields: 'id,name,mimeType,webViewLink,parents', supportsAllDrives: true
    });
    return result.data;
  }

  async function moveFile(fileId, addParents, removeParents) {
    return (await drive.files.update({
      fileId, addParents, removeParents, fields: 'id,name,parents', supportsAllDrives: true
    })).data;
  }

  async function trashFile(fileId) {
    await drive.files.update({fileId, requestBody: {trashed: true}, supportsAllDrives: true});
  }

  async function renameFile(fileId, name) {
    return (await drive.files.update({
      fileId, requestBody: {name}, fields: 'id,name', supportsAllDrives: true
    })).data;
  }

  async function downloadFile(fileId) {
    const result = await drive.files.get({
      fileId, alt: 'media', responseType: 'arraybuffer', supportsAllDrives: true
    });
    return Buffer.from(result.data);
  }

  async function exportPdf(fileId) {
    const result = await drive.files.export({
      fileId, mimeType: 'application/pdf', responseType: 'arraybuffer'
    });
    return Buffer.from(result.data);
  }

  async function createFile(name, parentId, mimeType, buffer) {
    const result = await drive.files.create({
      requestBody: {name, parents: [parentId], mimeType},
      media: {mimeType, body: Readable.from(buffer)},
      fields: 'id,name,mimeType,webViewLink,parents', supportsAllDrives: true
    });
    return result.data;
  }

  async function uploadFile(fileId, mimeType, buffer) {
    return (await drive.files.update({
      fileId, media: {mimeType, body: Readable.from(buffer)}, fields: 'id,name', supportsAllDrives: true
    })).data;
  }

  async function withPublicRead(fileId, callback) {
    const permission = await drive.permissions.create({
      fileId, requestBody: {role: 'reader', type: 'anyone'}, supportsAllDrives: true
    });
    try {
      return await callback();
    } finally {
      await drive.permissions.delete({
        fileId, permissionId: permission.data.id, supportsAllDrives: true
      }).catch(() => {});
    }
  }

  async function getDoc(documentId) {
    return (await docs.documents.get({documentId})).data;
  }

  async function batchUpdateDoc(documentId, requests) {
    if (!requests.length) return null;
    return (await docs.documents.batchUpdate({
      documentId, requestBody: {requests}
    })).data;
  }

  async function folderFor(uid, folderId) {
    const {data} = await project(uid);
    const rootId = extractDriveId(data.projectFolderUrl);
    if (!rootId) return {missing: true, name: '', folders: [], files: []};
    const requested = folderId || rootId;
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(requested)) throw new Error('Érvénytelen mappaazonosító.');
    let current = await file(requested);
    const folder = current;
    let inside = false;
    for (let depth = 0; depth < 30; depth++) {
      if (current.id === rootId) {inside = true; break;}
      if (!current.parents?.length) break;
      current = await file(current.parents[0]);
    }
    if (!inside || folder.mimeType !== 'application/vnd.google-apps.folder')
      throw new Error('A mappa nem a kiválasztott projekthez tartozik.');
    const children = await listChildren(folder.id);
    const compare = (a, b) => a.name.localeCompare(b.name, 'hu');
    return {
      id: folder.id, name: folder.name,
      folders: children.filter(item => item.mimeType === 'application/vnd.google-apps.folder')
        .map(item => ({id: item.id, name: item.name})).sort(compare),
      files: children.filter(item => item.mimeType !== 'application/vnd.google-apps.folder')
        .map(item => ({name: item.name, url: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`, mimeType: item.mimeType})).sort(compare),
      truncated: children.length >= 3000
    };
  }

  async function listProjects() {
    const rows = await allRows();
    const projects = [];
    for (let start = 0; start < rows.length; start += 8) {
      const batch = await Promise.all(rows.slice(start, start + 8).map(async ({row, rowNumber}) => {
        const item = projectFromRow(row, rowNumber);
        const id = extractDriveId(row[4]);
        if (id) {
          try {
            const current = await file(id);
            const parent = current.parents?.[0] ? await file(current.parents[0]) : null;
            if (parent) {
              if (['_Elkészült', '_Lezárt'].includes(parent.name)) {item.closed = true; item.stage = 'closed';}
              else item.stage = parent.name === '_Ajánlatok' ? 'preparation' : 'started';
            }
          } catch (_) { /* A Sheet rekordja megmarad akkor is, ha a Drive-mappa hiányzik. */ }
        }
        return item;
      }));
      projects.push(...batch);
    }
    return projects.sort((a, b) => b.order - a.order);
  }

  return {
    oauth, sheets, drive, docs, values, valuesIn, updateIn, appendIn, clearIn, batchUpdateIn,
    batchGet, update, append, clear,
    spreadsheet, getSheetId, ensureSheet, sheetRows, appendSheet, updateSheetRow, setCellLink,
    allRows, project, file, listChildren, findChild, createFolder, ensureFolder,
    copyFile, moveFile, trashFile, renameFile, downloadFile, exportPdf, createFile, uploadFile,
    withPublicRead, getDoc, batchUpdateDoc, folderFor, listProjects,
    isClosed: isClosedStatus
  };
}

module.exports = {googleClient, extractFolderLinks};
