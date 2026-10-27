'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {previewSummary,applyEmailEdits}=require('../server/email_draft.cjs');
const {renderEmailHtml}=require('../server/email_templates.cjs');

const base={to:'client@example.com',subject:'Ajánlat',htmlSource:'<p>Eredeti levél</p>',
  attachments:[{filename:'ajanlat.pdf',content:Buffer.from('%PDF-1.4'),contentType:'application/pdf'}]};

test('Az előnézet csak a melléklet adatait adja a böngészőnek',() => {
  const preview=previewSummary(base);
  assert.deepEqual(preview.attachments,[{filename:'ajanlat.pdf',size:8}]);
  assert.equal(JSON.stringify(preview).includes('%PDF'),false);
});

test('Az előnézet a küldéshez használt HTML-sablont adja vissza',() => {
  const url='https://example.test/download/preview-token';
  const preview=previewSummary({...base,downloads:[{id:'private-id',filename:'ajanlat.pdf'}]},url);
  assert.equal(preview.html,renderEmailHtml(base.htmlSource,url));
  assert.equal(preview.htmlSource,base.htmlSource);
  assert.equal(JSON.stringify(preview).includes('private-id'),false);
});

test('Szerkesztett tárgy, szöveg és további csatolmány kerül a levélbe',() => {
  const result=applyEmailEdits(base,{to:base.to,subject:'Módosított ajánlat',htmlSource:'<h2>Szerkesztett szöveg</h2>',
    extraAttachments:[{filename:'megjegyzes.txt',contentType:'text/plain',
      base64:Buffer.from('Kiegészítés').toString('base64')}]});
  assert.equal(result.to,base.to);
  assert.equal(result.subject,'Módosított ajánlat');
  assert.equal(result.htmlSource,'<h2>Szerkesztett szöveg</h2>');
  assert.deepEqual(result.attachments[0].content,base.attachments[0].content);
  assert.equal(result.attachments[1].content.toString(),'Kiegészítés');
});

test('A szerver visszautasítja a hibás tárgyat és a túl nagy további csatolmányt',() => {
  assert.throws(()=>applyEmailEdits(base,{to:base.to,subject:'Hibás\r\nBcc: x',htmlSource:'<p>Szöveg</p>'}),/tárgya/);
  assert.throws(()=>applyEmailEdits(base,{to:base.to,subject:'Jó',htmlSource:'<p>Szöveg</p>',extraAttachments:[{
    filename:'nagy.pdf',base64:Buffer.alloc(6*1024*1024+1).toString('base64')
  }]}),/6 MB/);
  assert.throws(()=>applyEmailEdits(base,{to:'mas@example.com',subject:'Jó',htmlSource:'<p>Szöveg</p>'}),
    /címzett az előnézet óta/);
});
