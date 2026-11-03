'use strict';

// A tulajdonosi Google-hozzáférés (GOOGLE_TRACKING_CREDENTIAL) állapotának
// ellenőrzése. Csak olvas, és nem ír ki tokent vagy titkot.
//
// Használat: node scripts/google_auth_check.cjs
//
// Ha a válasz „invalid_grant”, a frissítési token lejárt vagy visszavonták.
// A 7 napos lejárat oka a Google OAuth consent screen „Testing” állapota:
// ezt csak a Google Cloud Console-ban lehet véglegesen megszüntetni
// (Publish app → In production), utána egyszeri újraengedélyezés kell.

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ENV_FILE = path.join(__dirname, '..', '.env');

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

function projectId() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const match = /^(\d{6,})-[a-z0-9]+\.apps\.googleusercontent\.com$/i.exec(clientId);
  return match ? match[1] : '';
}

function instructions() {
  const id = projectId();
  process.stdout.write(
    '\nA 7 napos lejárat megszüntetése (egyszeri, Google Cloud Console):\n' +
    '  1. Nyisd meg: https://console.cloud.google.com/auth/audience' +
    (id ? '?project=' + id : '') + '\n' +
    '  2. A „Publishing status” legyen „Testing”; kattints a „Publish app” gombra,\n' +
    '     majd erősítsd meg. Ezután „In production” lesz.\n' +
    '  3. Engedélyezd újra a hozzáférést: /auth/google?renew=1 (a Google-fiók:\n' +
    '     ' + (process.env.OWNER_EMAIL || 'a tulajdonosi fiók') + ').\n' +
    '  4. Az új GOOGLE_TRACKING_CREDENTIAL értéket írd a Railway Variables közé,\n' +
    '     majd indítsd újra a szolgáltatást.\n');
}

async function main() {
  loadEnvFile();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  if (!encrypted) {
    process.stdout.write('Nincs GOOGLE_TRACKING_CREDENTIAL beállítva.\n');
    instructions();
    process.exitCode = 1;
    return;
  }
  let refreshToken;
  try {
    refreshToken = readTrackingCredential(secret, encrypted, owner);
  } catch (_) {
    process.stdout.write('A GOOGLE_TRACKING_CREDENTIAL nem olvasható vissza. ' +
      'Ellenőrizd a SESSION_SECRET és az OWNER_EMAIL értékét; ha ezek változtak, ' +
      'a korábbi hitelesítő nem éleszthető újra.\n');
    instructions();
    process.exitCode = 1;
    return;
  }
  const oauth = new google.auth.OAuth2(
    String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    String(process.env.BASE_URL || '').replace(/\/$/, '') + '/auth/callback');
  oauth.setCredentials({refresh_token: refreshToken});
  try {
    await oauth.getAccessToken();
    const drive = google.drive({version: 'v3', auth: oauth});
    const about = (await drive.about.get({fields: 'user(displayName,emailAddress)'})).data;
    const user = about.user || {};
    process.stdout.write('OK: a Google-hozzáférés érvényes.\n' +
      '  Fiók: ' + (user.emailAddress || owner) +
      (user.displayName ? ' (' + user.displayName + ')' : '') + '\n');
  } catch (error) {
    const data = error?.response?.data || {};
    const reason = String(data.error || '') + ' ' + String(data.error_description || '');
    const expired = /invalid_grant/i.test(reason) ||
      /invalid_grant/i.test(String(error.message || ''));
    process.stdout.write((expired ? 'LEJÁRT: ' : 'HIBA: ') +
      (expired ? 'a Google-hozzáférés érvénytelen (invalid_grant).\n'
        : (error.message || String(error)) + '\n'));
    if (expired) instructions();
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
