'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {google}=require('googleapis');
const {googleClient}=require('../server/google.cjs');

test('A projekt PDF auditja az építész és szakági aláírólapot is külön ellenőrzi',async()=>{
  const originalSheets=google.sheets,originalDrive=google.drive;
  const row=Array(65).fill('');row[0]='ABC123';
  row[4]='https://drive.google.com/drive/folders/project-root';
  const folder=id=>({id,name:id,mimeType:'application/vnd.google-apps.folder'});
  const pdf=(id,name)=>({id,name,mimeType:'application/pdf',size:'100'});
  const children={
    'project-root':[folder('PDFA'),folder('írásos'),folder('Adat társtervezőktől'),
      folder('PLN'),pdf('root-pdf','Helyszínrajz.pdf')],
    'PDFA':[pdf('plan','EK-01 Alaprajz.pdf'),pdf('pin-fail','Második terv.pdf')],
    'írásos':[pdf('architect','Aláírólap - építész.pdf')],
    'Adat társtervezőktől':[folder('Gépészet')],
    'Gépészet':[pdf('specialist','Alairo_cimlap.pdf')],
    'PLN':[pdf('other-pdf','Egyéb terv.pdf'),pdf('broken-pdf','Sérült.pdf'),
      pdf('signed-bad','Aláírt, nem PDF-A.pdf')]
  };
  const retained=[],uploaded=[];
  google.sheets=()=>({spreadsheets:{get:async()=>({data:{sheets:[]}}),
    values:{get:async options=>({data:{values:options.range.includes('Adatok')?[row]:[]}})}}});
  google.drive=()=>({files:{list:async options=>({data:{files:children[
    options.q.match(/'([^']+)' in parents/)?.[1]]||[]}}),
    get:async options=>options.alt==='media'?{data:Buffer.from('%PDF-1.7 test '+options.fileId)}:
      {data:{id:options.fileId,mimeType:'application/pdf',headRevisionId:options.fileId+'-revision',
        md5Checksum:crypto.createHash('md5').update('%PDF-1.7 test '+options.fileId).digest('hex'),
        parents:['PDFA']}},
    update:async options=>{const chunks=[];for await(const chunk of options.media.body)chunks.push(chunk);
      uploaded.push({id:options.fileId,bytes:Buffer.concat(chunks)});
      return {data:{id:options.fileId,md5Checksum:crypto.createHash('md5')
        .update(uploaded.at(-1).bytes).digest('hex')}}}},
    revisions:{update:async options=>{retained.push(options);
      return {data:{keepForever:options.fileId!=='pin-fail'}}}}});
  try {
    const client=googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'pdf-audit-main',sheetName:'Adatok',pdfQuality:{
        convertPdfA:async bytes=>Buffer.from('%PDF-1.7 converted '+bytes.toString()),
        inspectPdf:async bytes=>{if(bytes.includes('broken-pdf')){
          const error=new Error('A PDF-ellenőrző eszköz hibát jelzett: verapdf (kilépési kód: 7).');
          error.pdfTool='verapdf';error.pdfDiagnostic='Failed to parse PDF';throw error}
          return {pdfa:{compliant:bytes.includes('converted')||
            !bytes.includes('plan')&&!bytes.includes('pin-fail')&&!bytes.includes('signed-bad'),profile:'PDF/A-2B'},
          signature:{signed:!bytes.includes('plan')&&!bytes.includes('pin-fail'),verified:bytes.includes('architect'),
            signatures:[{signer:'Teszt',valid:true,trusted:true,fullDocument:true}]}}}
      }});
    const result=await client.auditProjectPdfs('ABC123');
    assert.equal(result.files.length,8);
    assert.equal(result.architectSignature.verified,true);
    assert.equal(result.specialistSignatures.present,true);
    assert.equal(result.specialistSignatures.verified,false);
    const plan=result.files.find(item=>item.id==='plan');
    assert.equal(plan.pdfa,true);assert.equal(plan.converted,true);
    assert.deepEqual(uploaded.map(item=>item.id),['plan']);
    assert.equal(retained[0].revisionId,'plan-revision');
    assert.equal(retained[0].requestBody.keepForever,true);
    assert.equal(result.files.find(item=>item.id==='signed-bad').pdfa,false);
    assert.match(result.files.find(item=>item.id==='pin-fail').meaning,/nem írta át/);
    assert.equal(result.files.find(item=>item.id==='other-pdf').path,'PLN/Egyéb terv.pdf');
    assert.equal(result.files.find(item=>item.id==='root-pdf').path,'Helyszínrajz.pdf');
    const broken=result.files.find(item=>item.id==='broken-pdf');
    assert.match(broken.meaning,/nem tudta befejezni/);
    assert.match(broken.action,/új PDF\/A-2b exportot/);
    assert.equal(broken.diagnostic,'Failed to parse PDF');
  } finally {google.sheets=originalSheets;google.drive=originalDrive;}
});
