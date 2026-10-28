'use strict';

// A műszaki leírás sablon „Tervezési adatok” táblázatának átírása a
// Tervezési adatok Template sheet Munkalap1 szerkezetére.
//
// Alapértéken csak tervez (dry-run). Élesítés: node scripts/update_technical_template.cjs --apply
//
// A helyőrzők a generátor meglévő jelölésrendszerét használják:
//   {{TERVEZESI_ADATOK:Munkalap1!E2}}   – közvetlen cellahivatkozás
//   {{TERVEZESI_ADATOK:megengedett_lakasszam_db}} – kézi mező a Műszaki leírás lapról
// A meglévő „Meglévő” oszlop törlését és a szintterületi mutató sor elhagyását
// a generátor végzi projekt szinten (server/google.cjs).

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const DOC_ID = process.env.TECHNICAL_TEMPLATE_DOC_ID ||
  '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA';
const ENV_FILE = path.join(__dirname, '..', '.env');
const APPLY = process.argv.includes('--apply');
const cell = address => `{{TERVEZESI_ADATOK:Munkalap1!${address}}}`;

// 8 sor × 4 oszlop. A sorok a Munkalap1 adatpontjai, a „Megengedett” oszlop
// a B-oszlop hatósági/övezeti értékeit mutatja.
const TABLE = [
  ['Megnevezés','Megengedett','Meglévő','Tervezett'],
  ['Telek területe','–',`${cell('E2')} m²`,`${cell('E2')} m²`],
  ['Beépítési százalék',`${cell('B3')} %`,cell('L2'),cell('M2')],
  ['Zöldfelületi arány',`${cell('B5')} %`,cell('L5'),cell('M5')],
  ['Szintterületi mutató',`${cell('B7')} m²/m²`,cell('L7'),cell('M7')],
  ['Építménymagasság',`max. ${cell('B6')} m`,`${cell('E6')} m`,`${cell('F6')} m`],
  ['Lakásszám','{{TERVEZESI_ADATOK:megengedett_lakasszam_db}} db',
    `${cell('E8')} db`,`${cell('F8')} db`],
  ['Parkolószám',`${cell('B9')} db`,`${cell('E9')} db`,`${cell('F9')} db`]
];
// A második táblázat az építményérték-számítás: a tervezett nettó alapterület
// a J7 cella (a H7 címkecella volt).
const VALUE_CELL_FIX = {from:'{{TERVEZESI_ADATOK:Munkalap1!H7}} m²',
  to:'{{TERVEZESI_ADATOK:Munkalap1!J7}} m²'};

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

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function cellText(tableCell) {
  return (tableCell.content || []).map(item => item.paragraph ? paragraphText(item) :
    item.table ? '' : '').join('').replace(/\n$/, '');
}

function findTable(document, needle) {
  for (const item of document.body?.content || []) {
    if (!item.table) continue;
    const text = (item.table.tableRows || []).map(row =>
      (row.tableCells || []).map(cellText).join(' ')).join(' ');
    if (text.includes(needle)) return item;
  }
  return null;
}

// A szöveges szakaszok (nem a táblázat) elavult cellahivatkozásai. A régi
// szerkezetben a H2/H7/H3/H5 értékcella volt, a mostani Munkalap1-ben viszont
// szöveges címke, ezért a helyes értékcellára kell mutatni.
const PROSE_FIXES = [
  // Előbb a zöldfelület zárójeles aránya, különben a H5 → J5 csere után
  // már két J5 hivatkozás lenne a sorban.
  ['m² ({{TERVEZESI_ADATOK:Munkalap1!J5}})','m² ({{TERVEZESI_ADATOK:Munkalap1!M5}})'],
  ['{{TERVEZESI_ADATOK:Munkalap1!H2}}','{{TERVEZESI_ADATOK:Munkalap1!J2}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!H7}}','{{TERVEZESI_ADATOK:Munkalap1!J7}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!H3}}','{{TERVEZESI_ADATOK:Munkalap1!J3}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!H5}}','{{TERVEZESI_ADATOK:Munkalap1!J5}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!E6}}','{{TERVEZESI_ADATOK:Munkalap1!F6}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!E8}}','{{TERVEZESI_ADATOK:Munkalap1!F8}}'],
  ['{{TERVEZESI_ADATOK:Munkalap1!E9}}','{{TERVEZESI_ADATOK:Munkalap1!F9}}']
];

function fixProse(text) {
  let result = text;
  // A szintterületi mutató egysége a szöveges sorban hiányzik. A környező
  // szóközök a dokumentumban eltérhetnek, ezért csak a jelölőre illesztünk.
  if (result.includes('{{TERVEZESI_ADATOK:Munkalap1!B7}}') &&
      !result.includes('{{TERVEZESI_ADATOK:Munkalap1!B7}} m²/m²'))
    result = result.split('{{TERVEZESI_ADATOK:Munkalap1!B7}}')
      .join('{{TERVEZESI_ADATOK:Munkalap1!B7}} m²/m²');
  for (const [from, to] of PROSE_FIXES) result = result.split(from).join(to);
  return result;
}

// Csak a megváltozott részt cseréli (közös előtag/utótag megtartásával), így a
// bekezdés többi szövegrésze és formázása érintetlen marad.
function proseEdits(document) {
  const edits = [];
  for (const item of document.body?.content || []) {
    if (!item.paragraph || item.table) continue;
    const oldText = item.paragraph.elements
      ?.map(part => part.textRun?.content || '').join('') || '';
    const newText = fixProse(oldText);
    if (!oldText.trim() || oldText === newText) continue;
    let prefix = 0;
    while (prefix < oldText.length && oldText[prefix] === newText[prefix]) prefix++;
    let suffix = 0;
    while (suffix < oldText.length - prefix && suffix < newText.length - prefix &&
      oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
    edits.push({start:item.startIndex + prefix,
      end:item.startIndex + oldText.length - suffix,
      text:newText.slice(prefix,newText.length - suffix),
      before:oldText.trim(), after:newText.trim()});
  }
  return edits;
}

async function main() {
  loadEnvFile();
  const docs = google.docs({version: 'v1', auth: authorize()});
  const read = async () => (await docs.documents.get({documentId: DOC_ID,
    includeTabsContent: false})).data;

  const before = await read();
  const table = findTable(before, 'Megengedett');
  if (!table) throw new Error('Nem található a „Tervezési adatok” táblázat (Megengedett fejléc).');
  const rows = table.table.tableRows.length;
  const columns = table.table.tableRows[0].tableCells.length;
  process.stdout.write(`Dokumentum: ${before.title}\n`);
  process.stdout.write(`Táblázat: ${rows} sor × ${columns} oszlop, ` +
    `cél: ${TABLE.length} sor × ${TABLE[0].length} oszlop\n`);
  if (columns !== TABLE[0].length)
    throw new Error('A táblázat oszlopszáma eltér a tervezettől: ' + columns);
  if (rows > TABLE.length)
    throw new Error('A táblázat több sort tartalmaz a tervezettnél: ' + rows);

  const valueTable = findTable(before, 'MINDÖSSZESEN');
  if (!valueTable) throw new Error('Nem található az építményérték-táblázat.');
  const valueCell = valueTable.table.tableRows[0].tableCells[3];
  const valueCellText = cellText(valueCell).trim();
  if (valueCellText !== VALUE_CELL_FIX.from && valueCellText !== VALUE_CELL_FIX.to)
    throw new Error('Az építményérték-táblázat cellája eltér a várttól: ' +
      JSON.stringify(valueCellText));

  process.stdout.write('\nÚj táblázat:\n');
  for (const row of TABLE) process.stdout.write('  | ' + row.join(' | ') + ' |\n');
  process.stdout.write(valueCellText === VALUE_CELL_FIX.to
    ? `\nÉpítményérték-táblázat: már a helyes cellára mutat (${VALUE_CELL_FIX.to})\n`
    : `\nÉpítményérték-táblázat: ${VALUE_CELL_FIX.from} → ${VALUE_CELL_FIX.to}\n`);

  const pendingProse = proseEdits(before);
  if (pendingProse.length) {
    process.stdout.write('\nSzöveges hivatkozások javítása:\n');
    for (const edit of pendingProse)
      process.stdout.write('  - ' + edit.before + '\n    → ' + edit.after + '\n');
  }

  if (!APPLY) {
    process.stdout.write('\nDRY-RUN: semmi nem módosult. Élesítés: ' +
      'node scripts/update_technical_template.cjs --apply\n');
    return;
  }

  const missing = TABLE.length - rows;
  if (missing > 0) {
    const requests = [];
    for (let index = 0; index < missing; index++) requests.push({insertTableRow:{
      tableCellLocation:{tableStartLocation:{index:table.startIndex},
        rowIndex:rows - 1},
      insertBelow:true}});
    await docs.documents.batchUpdate({documentId: DOC_ID, requestBody:{requests,
      writeControl:{requiredRevisionId:before.revisionId}}});
  }

  const after = await read();
  const target = findTable(after, 'Megengedett');
  const valueTarget = findTable(after, 'MINDÖSSZESEN');
  const edits = [];
  target.table.tableRows.forEach((row, rowIndex) => {
    row.tableCells.forEach((tableCell, columnIndex) => {
      const want = TABLE[rowIndex]?.[columnIndex];
      if (want === undefined) return;
      if (cellText(tableCell) === want) return;
      const content = tableCell.content || [];
      const start = content[0]?.startIndex;
      const end = content[content.length - 1]?.endIndex;
      if (start === undefined || end === undefined) return;
      edits.push({start, end:end - 1, text:want});
    });
  });
  const valueContent = valueTarget.table.tableRows[0].tableCells[3].content;
  if (cellText(valueTarget.table.tableRows[0].tableCells[3]).trim() !== VALUE_CELL_FIX.to)
    edits.push({start:valueContent[0].startIndex,
      end:valueContent[valueContent.length - 1].endIndex - 1, text:VALUE_CELL_FIX.to});

  edits.sort((a, b) => b.start - a.start);
  const requests = [];
  for (const edit of edits) {
    if (edit.end > edit.start)
      requests.push({deleteContentRange:{range:{startIndex:edit.start,endIndex:edit.end}}});
    requests.push({insertText:{location:{index:edit.start},text:edit.text}});
  }
  if (requests.length)
    await docs.documents.batchUpdate({documentId: DOC_ID, requestBody:{requests,
      writeControl:{requiredRevisionId:after.revisionId}}});

  // A táblázat módosítása eltolja a mögötte lévő bekezdések indexeit, ezért a
  // szöveges javításokat külön, friss kiolvasásból végezzük.
  const proseSource = await read();
  const prose = proseEdits(proseSource);
  if (prose.length) {
    const proseRequests = prose.sort((a, b) => b.start - a.start).map(edit => {
      const parts = [];
      if (edit.end > edit.start) parts.push({deleteContentRange:{range:{
        startIndex:edit.start,endIndex:edit.end}}});
      parts.push({insertText:{location:{index:edit.start},text:edit.text}});
      return parts;
    }).flat();
    await docs.documents.batchUpdate({documentId: DOC_ID, requestBody:{requests:proseRequests,
      writeControl:{requiredRevisionId:proseSource.revisionId}}});
  }

  const check = await read();
  const done = findTable(check, 'Megengedett');
  process.stdout.write('\nKész. Beolvasott táblázat:\n');
  done.table.tableRows.forEach(row => process.stdout.write('  | ' +
    row.tableCells.map(cellText).join(' | ') + ' |\n'));
  const remaining = proseEdits(check);
  process.stdout.write(remaining.length
    ? '\nFigyelem: még javítandó szöveges hivatkozás: ' + remaining.length + '\n'
    : '\nMinden szöveges hivatkozás a helyes értékcellára mutat.\n');
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
