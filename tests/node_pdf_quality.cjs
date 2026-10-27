'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseVeraPdf,parsePdfsig,acceptVeraPdfFailure,acceptPdfsigFailure,
  inspectPdf,convertPdfA}=require('../server/pdf_quality.cjs');

test('PDF/A jelentésből csak a tényleges megfelelést fogadja el',()=>{
  assert.deepEqual(parseVeraPdf('<validationReport profileName="PDF/A-2B validation profile" isCompliant="true">'),
    {compliant:true,profile:'PDF/A-2B validation profile'});
  assert.equal(parseVeraPdf('<validationReport profileName="PDF/A-2B" isCompliant="false">').compliant,false);
  assert.equal(parseVeraPdf('<validationReport profileName="PDF/A-2B" isCompliant="false"><rule status="failed"><description>Font &amp; ICC&#xa;profil hiányzik</description></rule></validationReport>').reason,
    'Font & ICC profil hiányzik');
  assert.throws(()=>parseVeraPdf('<report/>'),/értelmezhető/);
});

test('A veraPDF 1-es kódja szabályhibát jelent, ha van érvényes vizsgálati jelentés',()=>{
  assert.equal(acceptVeraPdfFailure({code:1},'<validationReport isCompliant="false">'),true);
  assert.equal(acceptVeraPdfFailure({code:2},'<validationReport isCompliant="false">'),false);
  assert.equal(acceptVeraPdfFailure({code:1},'Java exception'),false);
});

test('A digitális aláírás akkor ellenőrzött, ha ép, megbízható és a teljes fájlt fedi',()=>{
  const sample='Digital Signature Info of: file.pdf\nSignature #1:\n'+
    '  - Signer Certificate Common Name: Minta Tervező\n'+
    '  - Signing Time: Oct 07 2026 12:00:00\n'+
    '  - Total document signed\n'+
    '  - Signature Validation: Signature is Valid.\n'+
    '  - Certificate Validation: Certificate is Trusted.\n';
  const valid=parsePdfsig(sample);
  assert.equal(valid.signed,true);assert.equal(valid.verified,true);
  assert.equal(valid.signatures[0].signer,'Minta Tervező');
  assert.equal(parsePdfsig(sample.replace('Total document signed','Not total document signed')).verified,false);
  assert.equal(parsePdfsig(sample.replace('Certificate is Trusted','Certificate is Untrusted')).verified,false);
  assert.equal(parsePdfsig(sample.replace('Signature is Valid','Digest Mismatch')).verified,false);
  const twice=sample.replace('Total document signed','Not total document signed')+
    sample.slice(sample.indexOf('Signature #1:')).replace('Signature #1:','Signature #2:');
  assert.equal(parsePdfsig(twice).verified,true);
  assert.deepEqual(parsePdfsig('File contains no signatures'),{signed:false,signatures:[],verified:false});
  assert.deepEqual(parsePdfsig('Signature #1:\n The signature form field is not signed.'),
    {signed:false,signatures:[],verified:false});
});

test('A pdfsig aláírás nélküli és érvénytelen aláírású eredménye értelmezhető, a valódi hibája megállít',()=>{
  assert.equal(acceptPdfsigFailure({code:2},"File '/tmp/input.pdf' does not contain any signatures\n"),true);
  assert.equal(acceptPdfsigFailure({code:2},'',"File '/tmp/input.pdf' does not contain any signatures\n"),true);
  assert.equal(acceptPdfsigFailure({code:1},'Digital Signature Info of: input.pdf\nSignature #1:\n - Signature Validation: Digest Mismatch'),true);
  assert.equal(acceptPdfsigFailure({code:1},'Syntax Error: Could not open PDF'),false);
  assert.equal(acceptPdfsigFailure({code:2},'Usage: pdfsig [options]'),false);
});

test('Hibás PDF nem jut el a konvertáló vagy aláírásellenőrző eszközhöz',async()=>{
  await assert.rejects(inspectPdf(Buffer.from('nem pdf')),/PDF hiányzik/);
  await assert.rejects(convertPdfA(Buffer.from('nem pdf')),/PDF hiányzik/);
});
