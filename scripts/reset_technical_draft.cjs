'use strict';

// A tesztprojekt műszaki leírás DRAFT-ját a kukába teszi, és az indexből törli,
// hogy a következő generálás a friss sablonból új példányt készítsen.
// Csak DRAFT állapotú bejegyzést érint. A kimenet nem tartalmaz titkot.
//
// Használat: node scripts/reset_technical_draft.cjs [--apply]
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ENV_FILE = path.join(__dirname, '..', '.env');
const APPLY = process.argv.includes('--apply');
const UID = process.env.TECHNICAL_TEST_UID || '0E7E7BF6ED3D4DC2937E01F7F51C64C1';
const SHEET_ID = process.env.SHEET_ID || '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I';

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

function authorize() {
  const oauth = new google.auth.OAuth2(String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    String(process.env.GOOGLE_CLIENT_SECRET || '').trim());
  oauth.setCredentials({refresh_token:readTrackingCredential(
    String(process.env.SESSION_SECRET || '').trim(),
    String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim(),
    String(process.env.OWNER_EMAIL || '').trim())});
  return oauth;
}

async function main() {
  loadEnvFile();
  const auth = authorize();
  const sheets = google.sheets({version:'v4', auth});
  const drive = google.drive({version:'v3', auth});
  const rows = (await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,
    range:"'_DokumentumIndex'!A2:F"})).data.values || [];
  const index = rows.findIndex(row => String(row[0] || '').trim().toUpperCase() === UID &&
    String(row[1] || '') === 'muszakiLeiras');
  if (index < 0) {
    process.stdout.write('Nincs műszaki leírás bejegyzés az indexben.\n');
    return;
  }
  const row = rows[index];
  process.stdout.write('Index: '+index+2+'. sor, állapot: '+(row[3] || '')+
    ', dokumentum: '+(row[2] || '')+'\n');
  if (String(row[3] || '') !== 'DRAFT') throw new Error('Csak DRAFT állapotú bejegyzés törölhető.');
  if (!APPLY) {
    process.stdout.write('\nDRY-RUN: semmi nem módosult. Élesítés: '+
      'node scripts/reset_technical_draft.cjs --apply\n');
    return;
  }
  if (row[2]) await drive.files.update({fileId:String(row[2]),
    requestBody:{trashed:true},supportsAllDrives:true});
  await sheets.spreadsheets.values.update({spreadsheetId:SHEET_ID,
    range:`'_DokumentumIndex'!C${index+2}:F${index+2}`,valueInputOption:'RAW',
    requestBody:{values:[['','','','']]}});
  process.stdout.write('Kész: a DRAFT a kukába került, az index bejegyzése törölve.\n');
}

main().catch(error => {
  process.stderr.write('Hiba: '+(error.message || String(error))+'\n');
  process.exitCode = 1;
});
