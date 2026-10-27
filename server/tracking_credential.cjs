'use strict';
const crypto=require('node:crypto');

const AAD=Buffer.from('kocka-tracking-oauth-v1');
function key(secret){return crypto.createHash('sha256').update(secret).digest()}

function createTrackingCredential(secret,email,refreshToken){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))||!refreshToken)
    throw new Error('Hiányzó tulajdonosi OAuth-hitelesítés.');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(AAD);
  const data=Buffer.concat([cipher.update(JSON.stringify({email,refreshToken}),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}

function readTrackingCredential(secret,encrypted,owner){
  try{if(!/^[A-Za-z0-9_-]{50,4000}$/.test(String(encrypted)))throw Error();
    const bytes=Buffer.from(encrypted,'base64url');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));
    decipher.setAAD(AAD);decipher.setAuthTag(bytes.subarray(12,28));
    const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
    if(data.email!==owner||!data.refreshToken)throw Error();
    return data.refreshToken;
  }catch(_){throw new Error('A GOOGLE_TRACKING_CREDENTIAL érvénytelen. Jelentkezz be újra, és készíts új értéket.');}
}

module.exports={createTrackingCredential,readTrackingCredential};
