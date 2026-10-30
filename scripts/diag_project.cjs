'use strict';

// Egy projekt teljes adatkörnyezetének diagnosztikája: Adatok sor, projektmappa,
// Tervezési adatok Sheet (Munkalap1, Munkalap2, Rétegrend sablonok), PLN lista,
// Render fájlok. Csak olvas.
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const UID = String(process.argv[2] || '').trim().toUpperCase();

function loadEnvFile() {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function authorize() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = readTrackingCredential(secret, encrypted, owner);
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token: refreshToken});
  return oauth;
}

async function main() {
  loadEnvFile();
  const auth = authorize();
  const sheets = google.sheets({version: 'v4', auth});
  const drive = google.drive({version: 'v3', auth});
  const sheetId = String(process.env.SHEET_ID || '').trim();
  const adatok = (await sheets.spreadsheets.values.get({spreadsheetId: sheetId,
    range: "'Adatok'!A1:AN", valueRenderOption: 'FORMATTED_VALUE'})).data.values || [];
  const row = adatok.find(item => String(item[0] || '').trim().toUpperCase() === UID);
  if (!row) throw new Error('Nincs ilyen UID: ' + UID);
  const headers = adatok[0] || [];
  const record = {};
  headers.forEach((header, index) => { record[String(header || '')] = String(row[index] || ''); });
  const linkRows = (await sheets.spreadsheets.get({spreadsheetId: sheetId,
    ranges: ["'Adatok'!E2:E"], includeGridData: true,
    fields: 'sheets(data(rowData(values(hyperlink))))'})).data;
  const links = (linkRows.sheets?.[0]?.data?.[0]?.rowData || [])
    .map(item => item.values?.[0]?.hyperlink || '');
  const dataIndex = adatok.indexOf(row) - 1;
  const folderUrl = links[dataIndex] ||
    Object.entries(record).find(([key]) => /mappa/i.test(key))?.[1] || '';
  const folderId = (/\/folders\/([A-Za-z0-9_-]+)/.exec(folderUrl) || [])[1] || '';
  const out = {uid: UID, record, folderId, children: [], dataSheet: null, tabs: {}};
  if (folderId) {
    out.children = (await drive.files.list({q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType)', pageSize: 100, supportsAllDrives: true,
      includeItemsFromAllDrives: true})).data.files || [];
    const all = out.children.slice();
    for (const child of out.children.filter(item =>
      item.mimeType === 'application/vnd.google-apps.folder')) {
      const nested = (await drive.files.list({q: `'${child.id}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType)', pageSize: 100, supportsAllDrives: true,
        includeItemsFromAllDrives: true})).data.files || [];
      all.push(...nested);
    }
    out.allFiles = all;
    const sheetFile = all.find(item =>
      item.mimeType === 'application/vnd.google-apps.spreadsheet');
    if (sheetFile) {
      out.dataSheet = sheetFile;
      const meta = (await sheets.spreadsheets.get({spreadsheetId: sheetFile.id,
        fields: 'sheets(properties(title))'})).data;
      for (const tab of meta.sheets || []) {
        const title = tab.properties.title;
        const values = (await sheets.spreadsheets.values.get({spreadsheetId: sheetFile.id,
          range: `'${title}'!A1:AR60`, valueRenderOption: 'FORMATTED_VALUE'})).data.values || [];
        out.tabs[title] = values;
      }
    }
    const render = out.children.find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && /^render$/i.test(item.name));
    if (render) {
      out.render = (await drive.files.list({q: `'${render.id}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,modifiedTime)', pageSize: 200, supportsAllDrives: true,
        includeItemsFromAllDrives: true})).data.files || [];
    }
    const pln = out.children.find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && /^pln$/i.test(item.name));
    if (pln) {
      out.pln = (await drive.files.list({q: `'${pln.id}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size)', pageSize: 100, supportsAllDrives: true,
        includeItemsFromAllDrives: true})).data.files || [];
    }
    const pdfa = out.children.find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && /^pdfa$/i.test(item.name));
    if (pdfa) {
      out.pdfa = (await drive.files.list({q: `'${pdfa.id}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size)', pageSize: 100, supportsAllDrives: true,
        includeItemsFromAllDrives: true})).data.files || [];
    }
  }
  const output = path.join(process.env.TEMP || '.', 'opencode', 'kocka_project_' + UID + '.json');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
  console.log('Kimenet: ' + output);
  console.log('Projektmappa: ' + (folderId || 'nincs'));
  console.log('Adat Sheet: ' + (out.dataSheet?.name || 'nincs'));
  console.log('Munkalapok: ' + Object.keys(out.tabs).join(', '));
  console.log('Render: ' + (out.render || []).map(file => file.name).join(', '));
  console.log('PLN: ' + (out.pln || []).map(file => file.name).join(', '));
  console.log('PDFA: ' + (out.pdfa || []).map(file => file.name).join(', '));
}

main().catch(error => {
  console.error('Hiba: ' + (error.message || String(error)));
  process.exitCode = 1;
});
