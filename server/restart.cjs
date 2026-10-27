'use strict';

const SUBFOLDERS = new Set(['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render']);

function restartPostfix(value, now = new Date()) {
  const yymm = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Budapest',
    year:'2-digit',month:'2-digit'}).formatToParts(now);
  const part = kind => yymm.find(item => item.type === kind)?.value || '';
  const postfix = String(value || '').trim() || `MOD_${part('year')}${part('month')}`;
  if (postfix.length > 60 || /[\\/<>:"|?*\x00-\x1f]/.test(postfix))
    throw new Error('Az utótag legfeljebb 60 karakter lehet, fájlnévben tiltott karakter nélkül.');
  return postfix;
}

function appendPostfix(name, postfix) {
  const text = String(name || '').trim();
  if (!postfix || text.endsWith(' - '+postfix)) return text;
  const extension = text.match(/^(.*?)(\.[^.]+)$/);
  return extension ? `${extension[1]} - ${postfix}${extension[2]}` : `${text} - ${postfix}`;
}

function copiedName(item, postfix) {
  if (item.mimeType === 'application/vnd.google-apps.folder' && SUBFOLDERS.has(item.name))
    return item.name;
  if (String(item.name).toLowerCase() === 'helyiségek.txt') return item.name;
  return appendPostfix(item.name,postfix);
}

function expectedPath(path, postfix) {
  return String(path).split('/').map((part,index,parts) => {
    if (index < parts.length-1 && SUBFOLDERS.has(part)) return part;
    if (index === parts.length-1 && part.toLowerCase() === 'helyiségek.txt') return part;
    return appendPostfix(part,postfix);
  }).join('/');
}

module.exports = {SUBFOLDERS,restartPostfix,appendPostfix,copiedName,expectedPath};
