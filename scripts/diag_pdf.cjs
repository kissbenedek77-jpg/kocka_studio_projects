'use strict';

// Egy Drive PDF szövegének kimentése (csak olvas). Használat:
//   node scripts/diag_pdf.cjs <fileId> <kimenet.txt>
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');
const {pdfToText} = require('../server/pdf_text.cjs');

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

async function main() {
  loadEnvFile();
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = readTrackingCredential(secret, encrypted, owner);
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token: refreshToken});
  const drive = google.drive({version: 'v3', auth: oauth});
  const fileId = String(process.argv[2] || '').trim();
  const output = String(process.argv[3] || path.join(process.env.TEMP || '.', 'opencode',
    'pdf_text.txt')).trim();
  const response = await drive.files.get({fileId, alt: 'media', supportsAllDrives: true},
    {responseType: 'arraybuffer'});
  const text = await pdfToText(Buffer.from(response.data));
  fs.writeFileSync(output, text, 'utf8');
  console.log('Kimenet: ' + output);
  console.log('Karakterek: ' + text.length + ' | sorok: ' + text.split(/\r?\n/).length);
}

main().catch(error => {
  console.error('Hiba: ' + (error.message || String(error)));
  process.exitCode = 1;
});
