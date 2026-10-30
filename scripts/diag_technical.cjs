'use strict';

// Diagnosztika: a valós Adatok sheet projektjei és a legutóbb generált műszaki
// leírás tartalma. Csak olvas. A kimenet nem tartalmaz titkot.
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

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

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function documentText(document) {
  const lines = [];
  const walk = (content, depth) => {
    for (const item of content || []) {
      if (item.paragraph) {
        const text = paragraphText(item).replace(/\s+/g, ' ').trim();
        if (text) lines.push({type: 'p', depth, text});
      } else if (item.table) {
        const rows = (item.table.tableRows || []).map(row => (row.tableCells || [])
          .map(cell => (cell.content || []).map(child => child.paragraph ?
            paragraphText(child) : '').join('').replace(/\s+/g, ' ').trim()).join(' | '));
        lines.push({type: 'table', depth, rows});
      }
    }
  };
  walk(document.body?.content, 0);
  return lines;
}

async function main() {
  loadEnvFile();
  const auth = authorize();
  const sheets = google.sheets({version: 'v4', auth});
  const docs = google.docs({version: 'v1', auth});
  const sheetId = String(process.env.SHEET_ID || '').trim();
  const out = {sheetId, projects: [], docs: []};
  const adatok = (await sheets.spreadsheets.values.get({spreadsheetId: sheetId,
    range: "'Adatok'!A1:AN", valueRenderOption: 'FORMATTED_VALUE'})).data.values || [];
  const header = adatok[0] || [];
  const uidIndex = header.findIndex(value => /^uid$/i.test(String(value).trim()));
  const nameIndex = header.findIndex(value => /projekt/i.test(String(value)));
  out.header = header;
  out.projects = adatok.slice(1).map(row => ({uid: String(row[uidIndex] || '').trim(),
    name: String(row[nameIndex] || '').trim()})).filter(item => item.uid);
  out.index = (await sheets.spreadsheets.values.get({spreadsheetId: sheetId,
    range: "'_DokumentumIndex'!A2:E"})).data.values || [];
  const technical = out.index.filter(row => String(row[1]) === 'muszakiLeiras');
  for (const row of technical.slice(-3)) {
    const document = (await docs.documents.get({documentId: String(row[2]),
      includeTabsContent: false})).data;
    out.docs.push({uid: row[0], id: row[2], title: document.title,
      text: documentText(document)});
  }
  const output = path.join(process.env.TEMP || '.', 'opencode', 'kocka_diag.json');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(out, null, 2), 'utf8');
  console.log('Kimenet: ' + output);
  console.log('Projektek: ' + out.projects.length);
  console.log('Műszaki dokumentumok: ' + technical.length);
  for (const doc of out.docs) console.log(' - ' + doc.uid + ' | ' + doc.title);
}

main().catch(error => {
  console.error('Hiba: ' + (error.message || String(error)));
  process.exitCode = 1;
});
