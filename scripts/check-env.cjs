'use strict';
const {loadConfig, REQUIRED} = require('../server/config.cjs');
const {googleClient} = require('../server/google.cjs');
const {createStore} = require('../server/store.cjs');
const {sentMail} = require('../server/mail.cjs');
const {createMailer} = require('../server/mailer.cjs');
const domain = require('../server/domain.cjs');

// MARK: Környezet- és integrációellenőrzés (Railway shell: npm run check)
try {
  if (typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
} catch (_) { /* Nincs .env; Railway esetén a változók közvetlenül jönnek. */ }

const TIMEOUT = Number(process.env.CHECK_TIMEOUT_SECONDS || 20) * 1000;
const HINTS = {
  OWNER_REFRESH_TOKEN: 'a nyilvános /form űrlap mentéséhez',
  IMAP_USER: 'az elküldött levelek listázásához',
  IMAP_PASSWORD: 'az elküldött levelek listázásához',
  SMTP_USER: 'a levélküldéshez',
  SMTP_PASSWORD: 'a levélküldéshez',
  GEMINI_API_KEY: 'az AI-kivonathoz'
};

const results = [];
function record(name, status, detail) {
  results.push({name, status, detail});
}

async function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Időtúllépés: ' + label)), TIMEOUT);
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {return await Promise.race([promise, timeout]);} finally {clearTimeout(timer);}
}

async function check(name, label, callback) {
  try {
    const detail = await withTimeout(callback(), label);
    record(name, 'ok', detail || '');
  } catch (error) {
    record(name, 'fail', explain(error));
  }
}

// MARK: A Google gyakori hitelesítési hibáinak magyarázata
function explain(error) {
  const message = String(error && error.message || error);
  if (message.includes('invalid_grant'))
    return 'az OWNER_REFRESH_TOKEN lejárt vagy visszavonták – futtasd újra: npm run token';
  if (message.includes('invalid_client'))
    return 'a GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET nem stimmel';
  if (message === 'invalid_grant' || message.includes('invalid_token'))
    return 'a hozzáférési token érvénytelen – futtasd újra: npm run token';
  if (/\b(401|403)\b/.test(message) && /insufficient|permission|forbidden/i.test(message))
    return message + ' (hiányzó OAuth scope vagy nincs hozzáférés a fájlhoz)';
  return message;
}

async function geminiKey(store, config) {
  try {
    return String(await store.getConfig('GEMINI_API_KEY') || config.geminiApiKey || '').trim();
  } catch (_) {
    return String(config.geminiApiKey || '').trim();
  }
}

async function main() {
  const missing = REQUIRED.filter(name => !process.env[name]);
  if (missing.length) {
    record('Kötelező változók', 'fail', 'hiányzik: ' + missing.join(', '));
    return report();
  }
  record('Kötelező változók', 'ok', REQUIRED.join(', '));

  for (const name of Object.keys(HINTS)) {
    const present = Boolean(process.env[name]);
    record(name, present ? 'ok' : 'warn',
      present ? 'megvan' : 'hiányzik – ' + HINTS[name] + ' kell');
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    record('Konfiguráció', 'fail', error.message);
    return report();
  }

  const google = googleClient(config, config.ownerRefreshToken);
  const store = createStore(config, google);

  await check('Google Sheets', 'Sheets', async () => {
    const rows = await google.allRows();
    return `${rows.length} projekt sor a(z) ${config.sheetName} munkalapon`;
  });

  await check('Google Drive', 'Drive', async () => {
    const folder = await google.file(domain.TEMPLATE_ROOT_FOLDER_ID);
    return `sablonmappa: ${folder.name}`;
  });

  await check('Google Docs', 'Docs', async () => {
    const template = domain.DOCUMENT_TEMPLATES.ajanlat;
    const doc = await google.getDoc(template.templateId);
    return `sablon dokumentum: ${doc.title || template.templateId}`;
  });

  await check('IMAP', 'IMAP', async () => {
    const result = await sentMail(config).list('ellenorzes@example.invalid');
    if (!result.configured) throw new Error('Az IMAP_USER / IMAP_PASSWORD hiányzik.');
    return 'bejelentkezés és elküldött mappa rendben';
  });

  await check('SMTP', 'SMTP', async () => {
    const mailer = createMailer(config);
    if (!mailer.configured) throw new Error('Az SMTP-kapcsolat nincs beállítva.');
    await mailer.verify();
    return `kiszolgáló: ${config.smtpHost}:${config.smtpPort}`;
  });

  await check('Gemini', 'Gemini', async () => {
    const key = await geminiKey(store, config);
    if (!key) throw new Error('Nincs Gemini API-kulcs (env vagy _ProjektBeállítások).');
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {'x-goog-api-key': key}
    });
    if (response.status !== 200) throw new Error('HTTP ' + response.status + ' a Gemini API-tól.');
    const body = await response.json();
    return `${(body.models || []).length} elérhető modell, alapértelmezett: ${config.geminiModel}`;
  });

  return report();
}

function report() {
  const width = Math.max(...results.map(item => item.name.length));
  const icon = {ok: 'OK  ', warn: 'FIGY', fail: 'HIBA'};
  console.log('\nKocka – környezet ellenőrzés\n');
  for (const item of results) {
    console.log(`${icon[item.status]} ${item.name.padEnd(width)}  ${item.detail}`);
  }
  const failed = results.filter(item => item.status === 'fail').length;
  const warned = results.filter(item => item.status === 'warn').length;
  console.log(`\n${results.length - failed - warned} rendben, ${warned} figyelmeztetés, ${failed} hiba.\n`);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error('Az ellenőrzés nem futott le:', error.message);
  process.exitCode = 1;
});
