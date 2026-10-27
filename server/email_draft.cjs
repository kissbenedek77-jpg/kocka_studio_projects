'use strict';
const {renderEmailHtml,sanitizeEmailSource} = require('./email_templates.cjs');

const MAX_EXTRA_BYTES = 6 * 1024 * 1024;
const MAX_EXTRA_FILES = 5;

function previewSummary(message, downloadUrl = '') {
  return {to:message.to,subject:message.subject,htmlSource:message.htmlSource,
    downloadUrl,
    html:renderEmailHtml(message.htmlSource,downloadUrl),
    downloads:(message.downloads || []).map(item => ({filename:item.filename})),
    attachments:(message.attachments || []).map(item => ({
      filename:item.filename,size:item.content?.length || item.size || 0
    }))};
}

function applyEmailEdits(message, edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits))
    throw new Error('A levél előnézeti adatai hiányoznak.');
  if (String(edits.to || '').trim().toLowerCase() !== String(message.to).trim().toLowerCase())
    throw new Error('A címzett az előnézet óta megváltozott. Nyisd meg újra a levél előnézetét.');
  const subject = String(edits.subject ?? '').trim();
  const htmlSource = sanitizeEmailSource(edits.htmlSource);
  if (!subject || subject.length > 200 || /[\r\n\x00-\x1f]/.test(subject))
    throw new Error('A levél tárgya 1–200 karakter lehet, sortörés nélkül.');
  const files = edits.extraAttachments ?? [];
  if (!Array.isArray(files) || files.length > MAX_EXTRA_FILES)
    throw new Error('Legfeljebb öt további fájl csatolható.');
  let total = 0;
  const extra = files.map((item,index) => {
    if (!item || typeof item !== 'object' || typeof item.base64 !== 'string')
      throw new Error('Érvénytelen további csatolmány: '+(index+1));
    const filename = String(item.filename || '').trim();
    if (!filename || filename.length > 150 || /[\\/\x00-\x1f<>:"|?*]/.test(filename))
      throw new Error('Érvénytelen csatolmányfájlnév: '+(index+1));
    if (item.base64.length > Math.ceil(MAX_EXTRA_BYTES/3)*4)
      throw new Error('A további csatolmányok összesen legfeljebb 6 MB-osak lehetnek.');
    if (!item.base64 || item.base64.length%4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64))
      throw new Error('A csatolmány tartalma érvénytelen: '+filename);
    const content = Buffer.from(item.base64,'base64');
    if (content.toString('base64') !== item.base64)
      throw new Error('A csatolmány tartalma érvénytelen: '+filename);
    total += content.length;
    if (!content.length || total > MAX_EXTRA_BYTES)
      throw new Error('A további csatolmányok összesen legfeljebb 6 MB-osak lehetnek.');
    const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(item.contentType || '')) ?
      item.contentType : 'application/octet-stream';
    return {filename,content,contentType};
  });
  return {...message,subject,htmlSource,attachments:[...(message.attachments || []),...extra]};
}

module.exports = {MAX_EXTRA_BYTES,MAX_EXTRA_FILES,previewSummary,applyEmailEdits};
