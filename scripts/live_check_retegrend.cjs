'use strict';

// Éles ellenőrzés a tesztprojekten: a műszaki leírás DRAFT újragenerálása után
// a Metszetek tervlapból kiolvasott rétegrendek és a helyiséglista-táblázat
// formátumának vizsgálata. Csak olvas, kivéve a DRAFT újragenerálását (ez a
// felület normál művelete). A kimenet nem tartalmaz titkot és nem tartalmaz
// személyes adatot.
//
// Használat: node scripts/live_check_retegrend.cjs
const fs = require('node:fs');
const path = require('node:path');
const {googleClient} = require('../server/google.cjs');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const ENV_FILE = path.join(__dirname, '..', '.env');
const UID = process.env.TECHNICAL_TEST_UID || '0E7E7BF6ED3D4DC2937E01F7F51C64C1';
// Rajzi szöveg, ami nem kerülhet a rétegrendek közé.
const DRAWING_NOISE = /M\s*=\s*1\s*:|TERVJEGYZ[ÉE]K|M[ée]retar[áa]ny|JELMAGYAR[ÁA]ZAT/i;

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

// A beillesztett, több soros szöveg a Docsban lehet egy bekezdésen belüli
// sortörés is, ezért a bekezdéseket soronként bontjuk. A bekezdés szövege
// „\n”-nel zárul, ezt nem számítjuk külön üres sornak.
function bodyTexts(document) {
  return (document?.body?.content || []).filter(item => item.paragraph)
    .flatMap(item => {
      const lines = paragraphText(item).split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      return lines;
    });
}

function cellText(cell) {
  let out = '';
  for (const item of cell.content || []) {
    if (item.paragraph) out += paragraphText(item);
    if (item.table) out += ' ';
  }
  return out.replace(/\s+/g,' ').trim();
}

// A helyiséglista táblázata: két oszlop, az első sorban „Megnevezés”/„Helyiség”,
// a másodikban „Terület”. A Docs API a kész táblázat oszlopszélességét nem adja
// vissza, ezért itt a cellakitöltést (0,1 cm = 2,83 PT) ellenőrizzük; a 7/2 cm
// oszlopszélességet a tests/node_room_table_style.cjs ellenőrzi a kérés szintjén.
function roomTable(document) {
  for (const item of (document?.body?.content || [])) {
    if (!item.table) continue;
    const rows = (item.table.tableRows || []).map(row =>
      (row.tableCells || []).map(cellText));
    if (!rows.length || rows[0].length !== 2) continue;
    const header = rows[0].join(' ');
    if (!/megnevez|helyis[ée]g/i.test(header) || !/ter[üu]let/i.test(header)) continue;
    const style = item.table.tableRows?.[0]?.tableCells?.[0]?.tableCellStyle || {};
    return {rows,rowCount:rows.length,
      padding:Number(style.paddingLeft?.magnitude ?? NaN)};
  }
  return null;
}

// A rétegrend-blokkok: a címsor után tabulált „mennyiség – megnevezés” sorok.
function retegrendBlocks(texts) {
  const blocks = [];
  let current = null;
  for (const text of texts) {
    const line = text.replace(/\u00a0/g,' ');
    if (!line.trim()) { current = null; continue; }
    // A blokk címsora betűjel + sorszám + név (F1 Határoló fal).
    if (/^[FLPMTK]\d{0,2}[a-z]?\s+\S/.test(line.trim())) {
      current = {title:line.trim(),layers:[]};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const layer = line.replace(/^\t+/,'').trim();
    if (layer) current.layers.push(layer);
  }
  return blocks.filter(block => block.layers.length);
}

function thicknessOf(layer) {
  const match = /(\d+(?:[.,]\d+)?)\s*(cm|mm|m)\b/i.exec(layer);
  return match ? Number(match[1].replace(',','.')) : null;
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

function docIdFromUrl(url) {
  const match = /\/(?:d|document)\/([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
  return match ? match[1] : '';
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
  const docs = googleapi.docs({version:'v1',auth:oauth});

  process.stdout.write('DRAFT újragenerálása a tesztprojekten…\n');
  const generated = await withQuotaRetry(() => google.generateTechnicalDocument(UID),'generálás');
  process.stdout.write('  '+(generated.created ? 'új példány' : 'meglévő példány frissítve')+
    ': '+generated.url+'\n');
  for (const warning of generated.warnings || []) process.stdout.write('  FIGYELMEZTETÉS: '+warning+'\n');
  const documentId = docIdFromUrl(generated.url);
  if (!documentId) throw new Error('A generált dokumentum azonosítója nem olvasható ki.');
  const document = (await withQuotaRetry(() => docs.documents.get({documentId,
    includeTabsContent:false}),'olvasás')).data;
  const texts = bodyTexts(document);

  const blocks = retegrendBlocks(texts);
  process.stdout.write('\nRétegrend-blokkok: '+blocks.length+'\n');
  for (const block of blocks)
    process.stdout.write('  '+block.title+' – '+block.layers.length+' réteg\n');
  if (!blocks.length) throw new Error('A DRAFT-ban nincs rétegrend-blokk.');

  const problems = [];
  for (const block of blocks) {
    if (block.layers.length < 2)
      problems.push('a(z) „'+block.title+'” blokkban csak '+block.layers.length+' réteg van');
    // A rétegsor lehet vastagság nélküli folytatás (pl. ragasztás, háló), de a
    // blokkban legalább egy valódi vastagságnak (cm/mm/m) szerepelnie kell.
    if (!block.layers.some(layer => thicknessOf(layer) !== null))
      problems.push('a(z) „'+block.title+'” blokkban nincs vastagság (cm/mm/m)');
    for (const layer of block.layers) {
      if (!/[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/.test(layer))
        problems.push('anyagnév nélküli réteg: '+JSON.stringify(layer));
    }
  }

  // A rajzi felirat (lépték, tervjegyzék, méretarány) nem kerülhet a rétegrendek
  // közé; a blokkon kívüli szöveg kimarad.
  for (const block of blocks) {
    if (DRAWING_NOISE.test(block.title))
      problems.push('rajzi szöveg a rétegrend címében: '+JSON.stringify(block.title));
    for (const layer of block.layers)
      if (DRAWING_NOISE.test(layer))
        problems.push('rajzi szöveg a rétegben: '+JSON.stringify(layer));
  }

  const titles = blocks.map(block => block.title.toLowerCase());
  const separate = ['pincefal','lábazat','járda','terasz'].filter(kind =>
    titles.some(title => title.includes(kind)));
  process.stdout.write('Önálló szerkezetként felismert: '+
    (separate.length ? separate.join(', ') : 'nincs a tervlapon')+'\n');

  const table = roomTable(document);
  if (!table) problems.push('a helyiséglista táblázata nem található');
  else {
    process.stdout.write('\nHelyiséglista: '+table.rowCount+' sor, cellakitöltés '+
      (Number.isFinite(table.padding) ? table.padding.toFixed(2)+' pt' : 'nincs')+
      ' (0,1 cm = 2,83 pt)\n');
    if (!Number.isFinite(table.padding) || Math.abs(table.padding - 2.83) > 0.05)
      problems.push('a helyiséglista cellakitöltése nem 0,1 cm (2,83 pt)');
    if (!table.rows.some(row => /összesen|mindösszesen/i.test(row[0])))
      problems.push('a helyiséglistából hiányzik az összesítő sor');
  }

  const unresolved = texts.filter(text => /\{\{[^{}]+\}\}/.test(text));
  if (unresolved.length)
    problems.push(unresolved.length+' bekezdésben maradt feloldatlan {{…}} jelölő');

  const fields = await withQuotaRetry(() => google.getTechnicalFields(UID),'mezők');
  const values = new Map(fields.fields.map(field => [field.key,field.value]));
  for (const key of ['retegrend:fal_anyag','retegrend:fal_vastagsag','retegrend:fodem',
    'retegrend:fedelszek']) {
    const value = String(values.get(key) || '');
    process.stdout.write('  '+key+': '+(value || 'ÜRES')+'\n');
    if (/KIEG[ÉE]SZ[ÍI]TENDŐ/i.test(value))
      problems.push('a(z) '+key+' mező hiányjelölést tartalmaz');
  }

  if (problems.length) {
    process.stdout.write('\nHIBA:\n');
    for (const problem of problems) process.stdout.write('  – '+problem+'\n');
    throw new Error(problems.length+' ellenőrzés nem felelt meg.');
  }
  process.stdout.write('\nKész: a rétegrendek és a helyiséglista rendben.\n');
}

main().catch(error => {
  process.stderr.write('Hiba: '+(error.message || String(error))+'\n');
  process.exitCode = 1;
});
