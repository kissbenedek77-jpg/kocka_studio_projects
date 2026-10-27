'use strict';
const archiver = require('archiver');
const domain = require('./domain.cjs');
const documents = require('./documents.cjs');

const EMAIL_KINDS = ['offer', 'contract', 'intake', 'package'];
const PACKAGE_LIMIT_BYTES = 18 * 1024 * 1024;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// MARK: ZIP összeállítása memóriában (a Utilities.zip Node megfelelője)
function zipEntries(entries) {
  return new Promise((resolve, reject) => {
    const archive = new archiver.ZipArchive({zlib: {level: 9}});
    const chunks = [];
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('warning', error => {
      if (error && error.code === 'ENOENT') return;
      reject(error);
    });
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    entries.forEach(entry => archive.append(entry.content, {name: entry.name}));
    archive.finalize();
  });
}

async function projectName(store, ctx) {
  return domain.buildProjectFolderName(ctx.data) || ctx.data.projektCim || ctx.uid;
}

async function documentPdf(google, store, ctx, type) {
  const record = (await store.getDocumentRecords(ctx.uid)).find(item => item.type === type);
  if (!record) throw new Error('A küldendő dokumentum még nem készült el.');
  if (record.status !== 'FINAL') {
    const template = domain.DOCUMENT_TEMPLATES[type];
    await documents.syncDocument(google, store, record.id, type, ctx.data, template.templateId);
  }
  const file = await google.file(record.id);
  const content = await google.exportPdf(record.id);
  return {filename: file.name.replace(/\.+\s*$/, '') + '.pdf', content, contentType: 'application/pdf'};
}

async function packageAttachments(google, store, ctx, folder, name) {
  const entries = [];
  const included = new Set();
  for (const folderName of ['PDFA', 'írásos']) {
    const candidates = (await google.listChildren(folder.id))
      .filter(item => item.mimeType === FOLDER_MIME && item.name === folderName);
    if (!candidates.length) continue;
    for (const file of await google.listChildren(candidates[0].id)) {
      if (!/\.pdf$/i.test(file.name) || included.has(file.name)) continue;
      included.add(file.name);
      entries.push({name: file.name, content: await google.downloadFile(file.id)});
    }
  }
  for (const record of await store.getDocumentRecords(ctx.uid)) {
    const config = domain.DOCUMENT_TEMPLATES[record.type];
    if (!config || config.targetFolder !== 'írásos') continue;
    const file = await google.file(record.id);
    const pdfName = file.name.replace(/\.+\s*$/, '') + '.pdf';
    if (included.has(pdfName)) continue;
    included.add(pdfName);
    entries.push({name: pdfName, content: await google.exportPdf(record.id)});
  }
  if (!entries.length) throw new Error('Nincs küldhető PDF a PDFA vagy írásos mappában.');
  const totalBytes = entries.reduce((total, entry) => total + entry.content.length, 0);
  if (totalBytes > PACKAGE_LIMIT_BYTES)
    throw new Error('A tervcsomag meghaladja a 18 MB-ot; bontsd részekre a küldést.');
  return [{
    filename: name + ' - tervcsomag.zip',
    content: await zipEntries(entries),
    contentType: 'application/zip'
  }];
}

// MARK: A dashboardSendEmail Node megfelelője
async function sendProjectEmail(google, store, mailer, uid, kind, confirmation) {
  const ctx = await store.project(uid);
  kind = String(kind || '');
  if (EMAIL_KINDS.indexOf(kind) === -1) throw new Error('Ismeretlen e-mail típus.');
  if (confirmation !== 'email:' + kind + ':' + ctx.uid)
    throw new Error('Az e-mail küldés megerősítése hiányzik.');
  const recipient = String(ctx.data.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new Error('Az ügyfél e-mail-címe hiányzik vagy érvénytelen.');
  const name = await projectName(store, ctx);
  const message = {to: recipient, subject: '', body: '', attachments: []};
  if (kind === 'intake') {
    message.subject = 'Adatbekérő – ' + name;
    message.body = 'Kedves Ügyfelünk!\n\nKérjük, töltse ki vagy ellenőrizze a projekt adatlapját az alábbi linken:\n' +
      store.clientFormUrl(ctx.uid) + '\n\nÜdvözlettel:\nKocka Stúdió';
  } else if (kind === 'package') {
    const {getExistingProjectFolder} = require('./projects.cjs');
    const folder = await getExistingProjectFolder(google, store, ctx);
    if (!folder) throw new Error('A projektmappa nem található.');
    message.attachments = await packageAttachments(google, store, ctx, folder, name);
    message.subject = 'Tervcsomag – ' + name;
    message.body = 'Kedves Ügyfelünk!\n\nMellékelten küldjük a projekt tervcsomagját.\n\nÜdvözlettel:\nKocka Stúdió';
  } else {
    const type = kind === 'offer' ? 'ajanlat' : 'szerzodes';
    message.attachments = [await documentPdf(google, store, ctx, type)];
    message.subject = (kind === 'offer' ? 'Ajánlat' : 'Szerződés') + ' – ' + name;
    message.body = 'Kedves Ügyfelünk!\n\nMellékelten küldjük a projekt ' +
      (kind === 'offer' ? 'ajánlatát.' : 'szerződését.') +
      '\n\nÜdvözlettel:\nKocka Stúdió';
  }
  await mailer.send(message);
  return 'Az e-mail elküldve erre a címre: ' + recipient;
}

module.exports = {sendProjectEmail, zipEntries, documentPdf, packageAttachments, EMAIL_KINDS, PACKAGE_LIMIT_BYTES};
