'use strict';

// Diagnosztika: a műszaki leírás sablon szerkezete. Csak olvas, a kimenet nem
// tartalmaz titkot. Használat: node scripts/inspect_technical_template.cjs
const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const DOC_ID = process.env.TECHNICAL_DOC_ID || process.env.TECHNICAL_TEMPLATE_DOC_ID ||
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
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token:readTrackingCredential(secret, encrypted, owner)});
  return oauth;
}

function text(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function cellText(cell) {
  return (cell.content || []).map(item => item.paragraph ? text(item) : '').join('')
    .replace(/\n$/, '');
}

function dump(document) {
  const out = {title:document.title, documentStyle:document.documentStyle,
    namedRanges:Object.keys(document.namedRanges || {}), body:[], headers:{}, footers:{}};
  const walk = (content, depth, container) => {
    for (const item of content || []) {
      if (item.paragraph) {
        container.push({start:item.startIndex, end:item.endIndex, depth,
          style:item.paragraph.paragraphStyle?.namedStyleType || '',
          bullet:Boolean(item.paragraph.bullet),
          text:text(item).replace(/\n$/, '')});
      } else if (item.table) {
        container.push({start:item.startIndex, end:item.endIndex, depth, table:{
          rows:(item.table.tableRows || []).length,
          columns:(item.table.tableRows?.[0]?.tableCells || []).length,
          cells:(item.table.tableRows || []).map(row => (row.tableCells || []).map(cellText))
        }});
      } else if (item.tableOfContents) {
        container.push({start:item.startIndex, end:item.endIndex, depth, toc:true});
      } else {
        container.push({start:item.startIndex, end:item.endIndex, depth,
          other:Object.keys(item).filter(key => key !== 'startIndex' && key !== 'endIndex')});
      }
    }
  };
  walk(document.body?.content, 0, out.body);
  for (const [id, header] of Object.entries(document.headers || {}))
    walk(header.content, 0, (out.headers[id] = []));
  for (const [id, footer] of Object.entries(document.footers || {}))
    walk(footer.content, 0, (out.footers[id] = []));
  return out;
}

async function main() {
  loadEnvFile();
  const docs = google.docs({version:'v1', auth:authorize()});
  const document = (await docs.documents.get({documentId:DOC_ID,
    includeTabsContent:false})).data;
  const output = path.join(process.env.TEMP || '.', 'opencode', 'template_dump.json');
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, JSON.stringify(dump(document), null, 2), 'utf8');
  const markers = new Set();
  const scan = items => {
    for (const item of items || []) {
      if (item.text) for (const match of String(item.text).matchAll(/\{\{([^{}]+)\}\}/g))
        markers.add(match[1]);
      if (item.table) for (const row of item.table.cells) for (const cell of row)
        for (const match of String(cell).matchAll(/\{\{([^{}]+)\}\}/g)) markers.add(match[1]);
    }
  };
  scan(dump(document).body);
  console.log('Kimenet: ' + output);
  console.log('Bekezdés/táblázat elemek: ' + document.body.content.length);
  console.log('Jelölők: ' + [...markers].join(', '));
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
