'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {TEMPLATE_FILES,fillEmailTemplate,sanitizeEmailSource,renderEmailHtml,
  plainTextFromHtml,loadEmailTemplate}=require('../server/email_templates.cjs');

test('A négy helyi levélsablon előkészített és helyőrzőkkel renderelhető',()=>{
  for(const [kind,name] of Object.entries(TEMPLATE_FILES)){
    const source=fs.readFileSync(path.join(__dirname,'..','_System',name),'utf8');
    const filled=fillEmailTemplate(source,{projectName:'<Próba> & társai',
      formUrl:'https://example.test/form?uid=ABC123'});
    assert.match(filled,/&lt;Próba&gt; &amp; társai/);
    assert.doesNotMatch(filled,/\{\{PROJECT_NAME\}\}/);
    const html=renderEmailHtml(filled,kind==='intake'?'':'https://example.test/download/token');
    assert.match(html,/Kocka Stúdió/);
    assert.match(filled,/data-kocka-signature="1"/);
    assert.match(filled,/background-color:#77c59e/);
    assert.doesNotMatch(filled,/data-kocka-header|#1e4355/);
    if(kind==='intake')assert.match(html,/href="https:\/\/example\.test\/form\?uid=ABC123"/);
    if(kind!=='intake'){
      assert.match(filled,/data-kocka-placeholder="download-button"/);
      assert.match(filled,/data-kocka-placeholder="download-link"/);
      assert.match(html,/https:\/\/example\.test\/download\/token/);
      assert.match(html,/href="https:\/\/example\.test\/download\/token"/);
      assert.match(plainTextFromHtml(html),/https:\/\/example\.test\/download\/token/);
    }
  }
});

test('A HTML-tisztítás eltávolítja az aktív kódot, a helyőrzők törölhetők',()=>{
  const clean=sanitizeEmailSource('<p onclick="alert(1)">Helló<script>alert(2)</script></p>'+ 
    '<a href="javascript:alert(3)">rossz</a>');
  assert.doesNotMatch(clean,/onclick|script|javascript:/i);
  const html=renderEmailHtml('<p>Csak a szöveg maradt.</p>','https://example.test/download/token');
  assert.doesNotMatch(html,/download\/token/);
});

test('A Node a levélsablont a Drive _System mappájából tölti, és összevonja az olvasást',async()=>{
  const calls=[];
  const drive={files:{
    list:async options=>{calls.push(['list',options]);return {data:{files:[{id:'remote-offer',
      name:'ajanlat.html',mimeType:'text/html'}]}}},
    get:async options=>{calls.push(['get',options]);return {data:'<p>Drive sablon</p>'}}
  }};
  const [a,b]=await Promise.all([
    loadEmailTemplate(drive,'unique-system-folder-test','offer'),
    loadEmailTemplate(drive,'unique-system-folder-test','offer')
  ]);
  assert.equal(a,'<p>Drive sablon</p>');
  assert.equal(b,a);
  assert.equal(calls.length,2);
  assert.match(calls[0][1].q,/unique-system-folder-test/);
});
