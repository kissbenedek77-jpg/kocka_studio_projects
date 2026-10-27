'use strict';
const crypto = require('node:crypto');

const AAD = Buffer.from('kocka-email-pixel-v1');
const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64');
const MAX_AGE = 365 * 24 * 60 * 60 * 1000;

function createPixelToken(secret, data, now = Date.now()) {
  if (!/^[A-Z0-9-]{4,64}$/.test(data.uid) ||
      !/^[0-9a-f-]{36}$/.test(data.id) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.to))
    throw new Error('Érvénytelen levélkövetési adatok.');
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv);
  cipher.setAAD(AAD);
  const content=Buffer.concat([cipher.update(JSON.stringify({...data,expires:now+MAX_AGE}),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),content]).toString('base64url');
}

function readPixelToken(secret, token, now = Date.now()) {
  try {
    if (!/^[A-Za-z0-9_-]{40,2000}$/.test(String(token))) throw Error();
    const bytes=Buffer.from(token,'base64url');
    const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),bytes.subarray(0,12));
    decipher.setAAD(AAD);decipher.setAuthTag(bytes.subarray(12,28));
    const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    if (!/^[A-Z0-9-]{4,64}$/.test(data.uid) || !/^[0-9a-f-]{36}$/.test(data.id) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.to) ||
        !Number.isSafeInteger(data.expires) || data.expires<=now || data.expires>now+MAX_AGE) throw Error();
    return data;
  } catch (_) {throw Object.assign(new Error('Érvénytelen követőkép.'),{status:404});}
}

module.exports={PIXEL,createPixelToken,readPixelToken};
