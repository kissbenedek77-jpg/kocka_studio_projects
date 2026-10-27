'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {convertPdfA,inspectPdf}=require('../server/pdf_quality.cjs');

(async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'kocka-pdfa-smoke-'));
  try {
    const source=path.join(folder,'input.pdf');
    execFileSync(process.env.GHOSTSCRIPT_BIN||'gs',[
      '-dBATCH','-dNOPAUSE','-sDEVICE=pdfwrite',`-sOutputFile=${source}`,
      '-c','/Helvetica findfont 12 scalefont setfont 72 720 moveto (PDF-A smoke) show showpage'
    ],{timeout:30000,stdio:'pipe'});
    const output=await convertPdfA(await fs.readFile(source));
    const result=await inspectPdf(output);
    assert.equal(result.pdfa.compliant,true);
    assert.equal(result.signature.signed,false);
    process.stdout.write('PDF/A-2b konverzió és ellenőrzés: OK\n');
  } finally {await fs.rm(folder,{recursive:true,force:true});}
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
