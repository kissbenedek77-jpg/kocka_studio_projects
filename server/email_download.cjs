'use strict';
const crypto = require('node:crypto');

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const AAD = Buffer.from('kocka-email-download-v1');

function createDownloadToken(secret, payload, now = Date.now()) {
  if (!payload.refreshToken || !/^[A-Z0-9-]{4,64}$/.test(payload.uid) ||
      !Array.isArray(payload.files) || !payload.files.length || payload.files.length > 100 ||
      payload.files.some(file => !/^[A-Za-z0-9_-]{5,200}$/.test(file.id) ||
        typeof file.filename !== 'string' || !file.filename || file.filename.length > 200 ||
        !['application/pdf','application/vnd.google-apps.document'].includes(file.mimeType)))
    throw new Error('Érvénytelen letöltési adatok.');
  const data = {...payload,id:crypto.randomBytes(12).toString('base64url'),
    expires:now + MAX_AGE_MS};
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',
    crypto.createHash('sha256').update(secret).digest(),iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}

function readDownloadToken(secret, token, now = Date.now()) {
  try {
    if (!/^[A-Za-z0-9_-]{40,16000}$/.test(String(token))) throw Error();
    const bytes = Buffer.from(token,'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm',
      crypto.createHash('sha256').update(secret).digest(),bytes.subarray(0,12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(12,28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),
      decipher.final()]).toString('utf8'));
    if (!data.refreshToken || !data.id || !Array.isArray(data.files) || !data.files.length ||
        !Number.isSafeInteger(data.expires) || data.expires <= now ||
        data.expires > now + MAX_AGE_MS + CLOCK_SKEW_MS) throw Error();
    return data;
  } catch (_) {
    const error = new Error('A letöltési hivatkozás érvénytelen vagy lejárt.');
    error.status = 404;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function emailHtml(text, downloadUrl) {
  const body = escapeHtml(text);
  const download = downloadUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(downloadUrl)}" style="background:#1e4355;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Dokumentumok letöltése</a></p><p>Ha a gomb nem működik, másolja be ezt a hivatkozást a böngészőbe:<br><a href="${escapeHtml(downloadUrl)}">${escapeHtml(downloadUrl)}</a></p>` : '';
  return '<!doctype html><html lang="hu"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;line-height:1.5;color:#24333d"><div style="white-space:pre-wrap">'+body+'</div>'+download+'</body></html>';
}

function downloadPage(data, token) {
  const base='/download/'+encodeURIComponent(token);
  const multiple=data.files.length>1;
  const downloadPath=base+(multiple?'/archive':'/file/0');
  const filename=multiple?'Tervcsomag.zip':data.files[0].filename;
  const files=data.files.map((file,index)=>`<li><a href="${base}/file/${index}">${escapeHtml(file.filename)}</a></li>`).join('');
  return '<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dokumentumok letöltése</title><style>body{font-family:Arial,sans-serif;max-width:680px;margin:36px auto;padding:0 18px;color:#24333d;line-height:1.5}a{color:#145975}li{margin:10px 0}.status{padding:14px;background:#eef5f7;border-left:4px solid #1e4355}.error{background:#fff2f0;border-color:#a6372f}details{margin-top:24px}</style><script src="/download-client.js" defer></script></head><body><main id="download" data-path="'+escapeHtml(downloadPath)+'" data-filename="'+escapeHtml(filename)+'" data-expires="'+escapeHtml(data.expires||'')+'"><h1>Dokumentumok letöltése</h1><p id="downloadStatus" class="status" role="status">A letöltés előkészítése…</p><p><a id="downloadAgain" href="'+escapeHtml(downloadPath)+'" download="'+escapeHtml(filename)+'">Letöltés indítása újra</a></p><p id="downloadValidity" hidden></p><details><summary>A csomag fájljai külön is letölthetők</summary><ul>'+files+'</ul></details></main></body></html>';
}

const CRC_TABLE=Uint32Array.from({length:256},(_,index)=>{
  let value=index;
  for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
function crc32(bytes){let value=0xffffffff;
  for(const byte of bytes)value=CRC_TABLE[(value^byte)&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
}
function zipDocuments(files){
  if(!Array.isArray(files)||!files.length||files.length>100)
    throw new Error('Érvénytelen fájlcsomag.');
  const local=[],directory=[];let offset=0,total=0;
  const used=new Set();
  for(const file of files){
    const bytes=Buffer.from(file.bytes);
    if(!bytes.length||bytes.length>30*1024*1024||total+bytes.length>100*1024*1024)
      throw new Error('A tervcsomag túl nagy az egy kattintásos letöltéshez. A fájlok külön letölthetők.');
    total+=bytes.length;
    let name=String(file.filename||'dokumentum.pdf').replace(/[\x00-\x1f\x7f\\/]/g,'_');
    if(!name.toLowerCase().endsWith('.pdf'))name+='.pdf';
    const original=name;let suffix=2;
    while(used.has(name.toLocaleLowerCase('hu-HU'))){name=original.replace(/\.pdf$/i,` (${suffix++}).pdf`)}
    used.add(name.toLocaleLowerCase('hu-HU'));
    const encoded=Buffer.from(name,'utf8'),checksum=crc32(bytes);
    if(encoded.length>65535)throw new Error('A fájlnév túl hosszú.');
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x0800,6);header.writeUInt16LE(0x0021,12);
    header.writeUInt32LE(checksum,14);
    header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);
    header.writeUInt16LE(encoded.length,26);
    local.push(header,encoded,bytes);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);
    central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);
    central.writeUInt16LE(0x0021,14);
    central.writeUInt32LE(checksum,16);central.writeUInt32LE(bytes.length,20);
    central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(encoded.length,28);
    central.writeUInt32LE(offset,42);
    directory.push(central,encoded);
    offset+=header.length+encoded.length+bytes.length;
  }
  const directoryBytes=directory.reduce((sum,item)=>sum+item.length,0);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(directoryBytes,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...directory,end],offset+directoryBytes+end.length);
}

module.exports = {createDownloadToken,readDownloadToken,emailHtml,downloadPage,zipDocuments};
