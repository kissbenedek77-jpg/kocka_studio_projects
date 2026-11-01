'use strict';

// Csak olvasó ellenőrzés: a sablon KOCKA_SZOVEG_* tartományaiból kiolvasott
// fejezetszövegek hossza és eleje/vége. Használat:
//   node scripts/verify_technical_inline_texts.cjs
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');
const {sectionTexts} = require('../server/technical_texts.cjs');
const {PROGRAM_TEXTS} = require('./update_technical_inline_texts.cjs');

const DOC_ID = process.env.TECHNICAL_TEMPLATE_DOC_ID ||
  '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA';
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

function authorize() {
  const oauth = new google.auth.OAuth2(String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    String(process.env.GOOGLE_CLIENT_SECRET || '').trim());
  oauth.setCredentials({refresh_token:readTrackingCredential(
    String(process.env.SESSION_SECRET || '').trim(),
    String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim(),
    String(process.env.OWNER_EMAIL || '').trim())});
  return oauth;
}

const KEYS = ['TERVEZESI_PROGRAM:a','TERVEZESI_PROGRAM:g','TERVEZESI_PROGRAM:p',
  'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG','SZERKEZETEK LEÍRÁSA',
  'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'];

async function main() {
  loadEnvFile();
  const docs = google.docs({version:'v1', auth:authorize()});
  const document = (await docs.documents.get({documentId:DOC_ID,
    includeTabsContent:false})).data;
  const texts = sectionTexts(document);
  process.stdout.write('Tartományok: '+Object.keys(document.namedRanges || {}).length+
    ', kiolvasott szövegek: '+Object.keys(texts).length+'\n');
  for (const key of KEYS) {
    const text = texts[key] || '';
    process.stdout.write('\n--- '+key+' ('+text.length+' kar.)\n');
    process.stdout.write(JSON.stringify(text.slice(0,90))+'\n');
    process.stdout.write(JSON.stringify(text.slice(-70))+'\n');
  }
  // A program a)–p) szövegét a sablonba írt forrásszöveggel vetjük össze.
  for (const letter of Object.keys(PROGRAM_TEXTS)) {
    const key = 'TERVEZESI_PROGRAM:'+letter;
    const actual = texts[key] || '';
    const expected = PROGRAM_TEXTS[letter] || '';
    if (actual === expected) continue;
    let index = 0;
    while (index < actual.length && index < expected.length &&
      actual[index] === expected[index]) index++;
    process.stdout.write('\nELTÉR '+key+': elvárt '+expected.length+', olvasott '+
      actual.length+', első eltérés: '+index+'\n  elvárt: '+
      JSON.stringify(expected.slice(Math.max(0,index-25),index+25))+
      '\n  olvasott: '+JSON.stringify(actual.slice(Math.max(0,index-25),index+25))+'\n');
  }
}

main().catch(error => {
  process.stderr.write('Hiba: '+(error.message || String(error))+'\n');
  process.exitCode = 1;
});
