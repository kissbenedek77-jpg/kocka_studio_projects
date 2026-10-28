'use strict';

// Egyszeri, csak olvasó diagnosztika a műszaki leírás sablonhoz.
// Kiolvassa a dokumentum bekezdéseit és táblázatait, valamint a tervezési
// adatok sheet összes munkalapjának első celláit. Semmit nem módosít.
//
// Használat:
//   node scripts/google_probe.cjs
// A hitelesítő: GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON) vagy
// GOOGLE_SERVICE_ACCOUNT_FILE, alapértéken keys/service-account.json.
// A kulcs tartalma soha nem kerül kiírásra.

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const DOC_ID = process.env.TECHNICAL_TEMPLATE_DOC_ID ||
  '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA';
const SHEET_ID = process.env.PROJECT_DATA_TEMPLATE_ID ||
  '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg';
const OUTPUT = process.env.PROBE_OUTPUT ||
  path.join(process.env.TEMP || process.env.TMP || '.', 'opencode', 'google_probe.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

// A szerver Railway-en kapja a változókat; helyben a .env-ből olvassuk be.
// A .env a .gitignore-ban van, tartalma nem kerül kiírásra.
function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function credentials() {
  const inline = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inline) {
    try { return JSON.parse(inline); }
    catch { throw new Error('A GOOGLE_SERVICE_ACCOUNT_JSON nem érvényes JSON.'); }
  }
  const file = String(process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '').trim() ||
    path.join(__dirname, '..', 'keys', 'service-account.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Hitelesítés: szolgáltatásfiók-kulcs, vagy a tulajdonos OAuth-frissítő tokene
// a titkosított GOOGLE_TRACKING_CREDENTIAL változóból (a Railway-en már meglévő
// értékekkel). Szolgáltatásfiók-kulcs létrehozása szervezeti szabály miatt tiltott
// lehet, ezért ez a tartalék út nem igényel új Google-jogosultságot.
function authorize() {
  const key = credentials();
  if (key) {
    return {label: 'szolgáltatásfiók: ' + key.client_email,
      auth: new google.auth.GoogleAuth({credentials: key,
        scopes: ['https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/spreadsheets']})};
  }
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!secret || !encrypted || !owner || !clientId || !clientSecret)
    throw new Error('Nincs Google-hitelesítő. Tedd a .env fájlba a Railway-en már beállított ' +
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, OWNER_EMAIL és ' +
      'GOOGLE_TRACKING_CREDENTIAL értékeket (a .env nincs verziókezelve).');
  const refreshToken = readTrackingCredential(secret, encrypted, owner);
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token: refreshToken});
  return {label: 'tulajdonosi OAuth: ' + owner, auth: oauth};
}

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function tableText(table) {
  return (table.tableRows || []).map(row => (row.tableCells || [])
    .map(cell => (cell.content || []).map(item => item.paragraph ? paragraphText(item) :
      item.table ? '[beágyazott táblázat]' : '').join('').replace(/\s+/g, ' ').trim())
    .join(' | ')).join('\n');
}

// A cellák egyesítését (rowSpan/columnSpan) is rögzítjük, mert a táblázat
// újraépítéséhez tudni kell, mely cellák fednek több oszlopot.
function tableCells(table) {
  return (table.tableRows || []).map((row, rowIndex) => ({
    rowIndex,
    cells: (row.tableCells || []).map((cell, columnIndex) => ({
      columnIndex,
      rowSpan: cell.tableCellStyle?.rowSpan || 1,
      columnSpan: cell.tableCellStyle?.columnSpan || 1,
      text: (cell.content || []).map(item => item.paragraph ? paragraphText(item) :
        item.table ? '[beágyazott táblázat]' : '').join('').replace(/\s+/g, ' ').trim(),
      startIndex: cell.content?.[0]?.startIndex,
      endIndex: cell.content?.[0]?.endIndex
    }))
  }));
}

function documentTables(document) {
  const tables = [];
  (document.body?.content || []).forEach((item, index) => {
    if (!item.table) return;
    tables.push({
      bodyIndex: index,
      rows: (item.table.tableRows || []).length,
      columns: (item.table.tableRows?.[0]?.tableCells || []).length,
      text: tableText(item.table),
      cells: tableCells(item.table)
    });
  });
  return tables;
}

function bodyOutline(document) {
  return (document.body?.content || []).map((item, index) => ({
    index,
    type: item.table ? 'táblázat' : item.paragraph ? 'bekezdés' : 'egyéb',
    style: item.paragraph?.paragraphStyle?.namedStyleType || '',
    text: item.paragraph ? paragraphText(item).replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  }));
}

async function main() {
  loadEnvFile();
  const {auth, label} = authorize();
  const docs = google.docs({version: 'v1', auth});
  const sheets = google.sheets({version: 'v4', auth});

  const document = (await docs.documents.get({documentId: DOC_ID,
    includeTabsContent: false})).data;
  const metadata = (await sheets.spreadsheets.get({spreadsheetId: SHEET_ID,
    fields: 'properties(title),sheets(properties(title,index))'})).data;

  const result = {
    authenticatedAs: label,
    document: {id: DOC_ID, title: document.title, revisionId: document.revisionId,
      tables: documentTables(document), outline: bodyOutline(document)},
    sheet: {id: SHEET_ID, title: metadata.properties?.title,
      tabs: metadata.sheets?.map(item => item.properties?.title)},
    ranges: {}
  };
  const range = String(process.env.PROBE_RANGE || 'A1:P30').trim();
  result.formulas = {};
  for (const tab of result.sheet.tabs || []) {
    const quoted = `'${String(tab).replace(/'/g, "''")}'`;
    const formatted = (await sheets.spreadsheets.values.get({spreadsheetId: SHEET_ID,
      range: `${quoted}!${range}`, valueRenderOption: 'FORMATTED_VALUE'})).data.values || [];
    const formulas = (await sheets.spreadsheets.values.get({spreadsheetId: SHEET_ID,
      range: `${quoted}!${range}`, valueRenderOption: 'FORMULA'})).data.values || [];
    result.ranges[tab] = formatted;
    result.formulas[tab] = formulas;
  }
  const grid = (await sheets.spreadsheets.get({spreadsheetId: SHEET_ID,
    ranges: ["'Munkalap1'"], fields: 'sheets(properties(title),merges)'})).data;
  result.merges = grid.sheets?.[0]?.merges || [];
  const formats = (await sheets.spreadsheets.get({spreadsheetId: SHEET_ID, includeGridData: true,
    ranges: ["'Munkalap1'!A1:P30"],
    fields: 'sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue,' +
      'userEnteredFormat(numberFormat)))))'})).data;
  result.formats = {};
  (formats.sheets?.[0]?.data?.[0]?.rowData || []).forEach((row, rowIndex) => {
    (row.values || []).forEach((cell, columnIndex) => {
      const shown = cell.formattedValue;
      const pattern = cell.userEnteredFormat?.numberFormat?.pattern ||
        cell.userEnteredFormat?.numberFormat?.type;
      if (!String(shown ?? '').trim() && !pattern) return;
      let name = '', n = columnIndex;
      while (true) { name = String.fromCharCode(65 + (n % 26)) + name;
        n = Math.floor(n / 26) - 1; if (n < 0) break; }
      result.formats[name + (rowIndex + 1)] = {
        value: String(shown ?? ''),
        formula: cell.userEnteredValue?.formulaValue || '',
        numberFormat: cell.userEnteredFormat?.numberFormat || null
      };
    });
  });

  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(`Hitelesítés: ${label}\n`);
  process.stdout.write(`Dokumentum: ${document.title}\n`);
  process.stdout.write(`Táblázatok: ${result.document.tables.length}\n`);
  result.document.tables.forEach((table, i) => process.stdout.write(
    `  [${i}] ${table.rows} sor × ${table.columns} oszlop\n`));
  process.stdout.write(`Sheet: ${result.sheet.title} (${(result.sheet.tabs || []).join(', ')})\n`);
  process.stdout.write(`Részletes kimenet: ${OUTPUT}\n`);
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
