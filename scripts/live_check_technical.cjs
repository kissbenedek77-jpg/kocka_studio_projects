'use strict';

// Éles ellenőrzés a tesztprojekten: a műszaki leírás DRAFT újragenerálása,
// a tervjegyzék-táblázat, a sablonból beírt fejezetszövegek, az űrlap előtöltése
// és a mentés utáni automatikus szinkron. A kimenet nem tartalmaz titkot.
//
// Használat: node scripts/live_check_technical.cjs
const fs = require('node:fs');
const path = require('node:path');
const {googleClient} = require('../server/google.cjs');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ENV_FILE = path.join(__dirname, '..', '.env');
const UID = process.env.TECHNICAL_TEST_UID || '0E7E7BF6ED3D4DC2937E01F7F51C64C1';
const CHECK_KEY = 'TERVEZESI_PROGRAM:b';
const CHECK_TEXT = 'Éles ellenőrzés: a program b) pontja az űrlapról került a leírásba.';

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

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function bodyTexts(document) {
  return (document?.body?.content || []).filter(item => item.paragraph)
    .map(item => paragraphText(item).replace(/\n$/,''));
}

function docIdFromUrl(url) {
  const match = /\/(?:d|document)\/([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
  return match ? match[1] : '';
}

function describePlanTable(document) {
  const tables = (document?.body?.content || []).filter(item => item.table);
  for (const item of tables) {
    const rows = (item.table.tableRows || []).map(row =>
      (row.tableCells || []).map(cell => (cell.content || [])
        .map(part => part.paragraph ? paragraphText(part) : '').join('').trim()));
    const flat = rows.flat().join(' ');
    if (!/M=1:|tervlap|helyszínrajz|alaprajz|metszet|homlokzat/i.test(flat)) continue;
    const firstCell = item.table.tableRows?.[0]?.tableCells?.[0];
    const style = firstCell?.tableCellStyle || {};
    return {rows:rows.slice(0,4),rowCount:rows.length,columns:rows[0]?.length || 0,
      padding:{left:style.paddingLeft?.magnitude,top:style.paddingTop?.magnitude},
      border:{top:style.borderTop?.width?.magnitude,
        left:style.borderLeft?.width?.magnitude}};
  }
  return null;
}

async function withQuotaRetry(call, label, waitMs = 65000) {
  try { return await call(); }
  catch (error) {
    if (error.status !== 429) throw error;
    process.stdout.write('  ('+label+': az API-keret betelt, várakozás '+
      Math.round(waitMs/1000)+' s…)\n');
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return call();
  }
}

async function main() {
  loadEnvFile();
  const refreshToken = readTrackingCredential(String(process.env.SESSION_SECRET || '').trim(),
    String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim(),
    String(process.env.OWNER_EMAIL || '').trim());
  const config = {
    baseUrl:String(process.env.BASE_URL || '').replace(/\/$/,''),
    clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,
    ownerEmail:String(process.env.OWNER_EMAIL || '').toLowerCase(),
    sessionSecret:process.env.SESSION_SECRET,
    sheetId:process.env.SHEET_ID || '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I',
    sheetName:process.env.SHEET_NAME || 'Adatok',
    templateRootFolderId:process.env.TEMPLATE_ROOT_FOLDER_ID || '1yw8ts2OTQTK0y2dn8TnovvR5HbWSqHWd',
    systemFolderId:process.env.SYSTEM_FOLDER_ID || '1zmwwzmeZybDfT5xIsVgEpfp6LIHzRv0r',
    projectDataTemplateId:process.env.PROJECT_DATA_TEMPLATE_ID ||
      '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg'
  };
  const {google:googleapi} = require('googleapis');
  const oauth = new googleapi.auth.OAuth2(config.clientId,config.clientSecret);
  oauth.setCredentials({refresh_token:refreshToken});
  const google = googleClient(config,refreshToken,oauth);
  const fieldsOf = async () => {
    const data = await google.getTechnicalFields(UID);
    const map = new Map(data.fields.map(field => [field.key,field.value]));
    return {map,sheetUrl:data.sheetUrl};
  };
  const original = await fieldsOf();
  process.stdout.write('Kiinduló mezők: '+['TERVEZESI_PROGRAM:a','TERVEZESI_PROGRAM:b',
    'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG'].map(key =>
    key+'='+(original.map.get(key) ? original.map.get(key).length+' kar.' : 'üres')).join(', ')+'\n');

  process.stdout.write('\nDRAFT generálása…\n');
  const generated = await withQuotaRetry(() => google.generateTechnicalDocument(UID),'generálás');
  process.stdout.write('Üzenet: '+generated.message+'\nDokumentum: '+generated.url+'\n');
  const documentId = docIdFromUrl(generated.url);
  if (!documentId) throw new Error('A generált dokumentum azonosítója nem olvasható ki.');

  const docs = googleapi.docs({version:'v1',auth:oauth});
  const readDoc = async () => (await docs.documents.get({documentId,
    includeTabsContent:false})).data;
  let document = await readDoc();
  const fields = await fieldsOf();
  process.stdout.write('\nŰrlap a generálás után:\n');
  for (const key of ['TERVEZESI_PROGRAM:a','TERVEZESI_PROGRAM:b','TERVEZESI_PROGRAM:g',
    'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG','SZERKEZETEK LEÍRÁSA',
    'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'])
    process.stdout.write('  '+key+': '+(fields.map.get(key) || '').length+' kar.\n');

  const plan = describePlanTable(document);
  process.stdout.write('\nTervjegyzék táblázat: '+(plan ?
    plan.rowCount+' sor × '+plan.columns+' oszlop, padding '+
    JSON.stringify(plan.padding)+', keret '+JSON.stringify(plan.border) : 'NEM TALÁLHATÓ')+'\n');
  if (plan) for (const row of plan.rows) process.stdout.write('  '+JSON.stringify(row)+'\n');
  const texts = bodyTexts(document);
  process.stdout.write('\nNévre szóló tartományok: '+
    Object.keys(document.namedRanges || {}).length+'\n');
  process.stdout.write('Nyers {{TERVJEGYZEK}} a szövegben: '+
    texts.some(text => text.includes('{{TERVJEGYZEK}}'))+'\n');
  process.stdout.write('Nyers {{...}} a folyószövegben: '+
    texts.filter(text => /\{\{[^{}]+\}\}/.test(text)).length+' bekezdés\n');
  process.stdout.write('b) pont: '+JSON.stringify((texts.find(text =>
    /^b\) Tervezési előzmények/.test(text)) || '').slice(0,110))+'\n');
  process.stdout.write('Tűzvédelmi bekezdés eleje: '+JSON.stringify((texts.find(text =>
    /^Az épület mértékadó kockázati osztálya/.test(text)) || '').slice(0,80))+'\n');

  process.stdout.write('\nMentés az űrlapról, automatikus szinkronnal…\n');
  const saved = await withQuotaRetry(() => google.saveTechnicalFields(UID,
    {[CHECK_KEY]:CHECK_TEXT},{sync:true}),'mentés');
  process.stdout.write('  synced='+saved.synced+' – '+saved.syncMessage+'\n');
  document = await readDoc();
  const after = bodyTexts(document).find(text => /^b\) Tervezési előzmények/.test(text)) || '';
  process.stdout.write('  A DRAFT b) pontja: '+JSON.stringify(after.slice(0,110))+'\n');
  const applied = after.includes(CHECK_TEXT);
  process.stdout.write('  A módosítás bekerült: '+applied+'\n');

  process.stdout.write('\nEredeti érték visszaállítása…\n');
  const restoreValue = original.map.get(CHECK_KEY) === CHECK_TEXT ? ''
    : (original.map.get(CHECK_KEY) || '');
  const restore = await withQuotaRetry(() => google.saveTechnicalFields(UID,
    {[CHECK_KEY]:restoreValue},{sync:true}),'visszaállítás');
  process.stdout.write('  synced='+restore.synced+'\n');

  if (!plan) throw new Error('A tervjegyzék nem táblázatként jelenik meg.');
  if (!applied) throw new Error('A mentett szöveg nem került be a DRAFT-ba.');
  process.stdout.write('\nKész: minden ellenőrzés rendben.\n');
}

main().catch(error => {
  process.stderr.write('Hiba: '+(error.message || String(error))+'\n');
  process.exitCode = 1;
});
