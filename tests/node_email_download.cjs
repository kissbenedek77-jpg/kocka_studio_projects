'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDownloadToken,readDownloadToken,emailHtml,downloadPage,zipDocuments}=
  require('../server/email_download.cjs');

const secret='test session secret with at least 32 characters';
const grant={uid:'ABC123',kind:'offer',to:'client@example.com',subject:'Ajánlat',
  refreshToken:'test-refresh-token',files:[{id:'document12345',
    filename:'Árajánlat <2026>.pdf',mimeType:'application/vnd.google-apps.document'}]};

test('A letöltő hivatkozás titkosított és 30 nap után lejár',() => {
  const now=Date.parse('2026-10-03T12:00:00Z');
  const token=createDownloadToken(secret,grant,now);
  assert.equal(token.includes('test-refresh-token'),false);
  assert.equal(token.includes('client@example.com'),false);
  assert.equal(readDownloadToken(secret,token,now+1000).files[0].id,'document12345');
  assert.equal(readDownloadToken(secret,token,now-2*60*1000).files[0].id,'document12345');
  assert.throws(()=>readDownloadToken(secret,token,now-6*60*1000),/érvénytelen/);
  assert.throws(()=>readDownloadToken(secret,token,now+31*86400000),/lejárt/);
  assert.throws(()=>readDownloadToken(secret,token.slice(0,-2)+'xx',now),/érvénytelen/);
  assert.throws(()=>readDownloadToken('másik titok',token,now),/érvénytelen/);
});

test('A HTML levél gombot és szöveges URL-t tartalmaz; a fájlnevek escape-elve vannak',() => {
  const url='https://example.test/download/secret-token';
  const html=emailHtml('Kedves <Ügyfelünk>!',url);
  assert.match(html,/Dokumentumok letöltése/);
  assert.match(html,/Ha a gomb nem működik/);
  assert.equal(html.includes('Kedves <Ügyfelünk>!'),false);
  assert.match(html,/Kedves &lt;Ügyfelünk&gt;!/);
  const page=downloadPage(grant,'secret-token');
  assert.match(page,/Árajánlat &lt;2026&gt;\.pdf/);
  assert.match(page,/\/download\/secret-token\/file\/0/);
  assert.match(page,/data-path="\/download\/secret-token\/file\/0"/);
  assert.match(page,/id="downloadValidity" hidden/);
  assert.match(page,/download-client\.js/);
});

test('Több dokumentum egy ZIP letöltési útvonalat kap, külön fájllinkekkel',()=>{
  const files=[...grant.files,{id:'document67890',filename:'Alaprajz.pdf',
    mimeType:'application/vnd.google-apps.document'}];
  const page=downloadPage({...grant,files,expires:Date.parse('2026-11-03T12:00:00Z')},'secret-token');
  assert.match(page,/data-path="\/download\/secret-token\/archive"/);
  assert.match(page,/data-filename="Tervcsomag\.zip"/);
  assert.match(page,/\/download\/secret-token\/file\/1/);
  const zip=zipDocuments(files.map((file,index)=>({filename:file.filename,
    bytes:Buffer.from('PDF '+index)})));
  assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length-22+10),2);
  assert.ok(zip.includes(Buffer.from('Árajánlat <2026>.pdf','utf8')));
  assert.ok(zip.includes(Buffer.from('Alaprajz.pdf','utf8')));
});
