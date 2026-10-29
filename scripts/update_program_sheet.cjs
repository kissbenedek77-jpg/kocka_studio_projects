'use strict';

// A „Tervezési program” munkalap a)–p) sorait tölti fel a kanonikus szöveggel.
// A szöveg a sablon adatlapján így szerkeszthető marad; a generátor a {{...}}
// jelölőket a projekt adataival tölti ki. Az üres sorokra a kód alapértéke lép.
//
// Alapértéken csak tervez (dry-run). Élesítés: node scripts/update_program_sheet.cjs --apply

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');
const {PROGRAM_TEXTS, PROGRAM_LETTERS} = require('../server/technical_program.cjs');

const ENV_FILE = path.join(__dirname, '..', '.env');
const APPLY = process.argv.includes('--apply');

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
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!secret || !encrypted || !owner || !clientId || !clientSecret)
    throw new Error('Nincs Google-hitelesítő a .env fájlban.');
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token: readTrackingCredential(secret, encrypted, owner)});
  return oauth;
}

async function main() {
  loadEnvFile();
  const spreadsheetId = process.env.PROJECT_DATA_TEMPLATE_ID ||
    '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg';
  const sheets = google.sheets({version:'v4', auth:authorize()});
  const values = PROGRAM_LETTERS.map(letter => [letter + ') ' + PROGRAM_TEXTS[letter]]);
  process.stdout.write(`Adatlap: ${spreadsheetId}\nCél: „Tervezési program”!B2:B${1 + values.length}\n\n`);
  for (const [row] of values) process.stdout.write('  ' + row.split('\n')[0] + '\n');

  const current = (await sheets.spreadsheets.values.get({spreadsheetId,
    range:"'Tervezési program'!A1:B17", valueRenderOption:'FORMATTED_VALUE'})).data.values || [];
  const filled = current.slice(1).filter(row => String(row?.[1] || '').trim()).length;
  process.stdout.write(`\nJelenleg kitöltött sorok: ${filled}/${PROGRAM_LETTERS.length}\n`);

  if (!APPLY) {
    process.stdout.write('\nDRY-RUN: semmi nem módosult. Élesítés: ' +
      'node scripts/update_program_sheet.cjs --apply\n');
    return;
  }

  await sheets.spreadsheets.values.update({spreadsheetId,
    range:`'Tervezési program'!B2:B${1 + values.length}`,
    valueInputOption:'RAW', requestBody:{values}});

  const check = (await sheets.spreadsheets.values.get({spreadsheetId,
    range:"'Tervezési program'!A1:B17", valueRenderOption:'FORMATTED_VALUE'})).data.values || [];
  const written = check.slice(1).filter(row => String(row?.[1] || '').trim()).length;
  process.stdout.write(`\nKész. Kitöltött sorok: ${written}/${PROGRAM_LETTERS.length}\n`);
  if (written !== PROGRAM_LETTERS.length) throw new Error('Nem minden program-sor íródott be.');
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
