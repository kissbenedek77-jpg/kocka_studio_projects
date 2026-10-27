'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const MAX_PDF_BYTES=30*1024*1024;

function parseVeraPdf(report) {
  const match=String(report).match(/<validationReport\b([^>]*)>/i);
  if(!match) throw new Error('A veraPDF nem adott értelmezhető PDF/A jelentést.');
  const attrs=match[1];
  const compliant=/\bisCompliant="true"/i.test(attrs);
  const profile=attrs.match(/\bprofileName="([^"]+)"/i)?.[1]||'';
  const result={compliant,profile};
  if(!compliant){const raw=String(report).match(/<rule\b(?=[^>]*\bstatus="failed")[^>]*>[\s\S]*?<description>([\s\S]*?)<\/description>/i)?.[1];
    if(raw)result.reason=raw.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi,(_,hex,decimal)=>{
      const code=parseInt(hex||decimal,hex?16:10);return code>=0&&code<=0x10ffff?String.fromCodePoint(code):''
    }).replace(/&(?:amp|lt|gt|quot|apos);/g,
      value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[value])
      .replace(/\s+/g,' ').trim().slice(0,300)}
  return result;
}

function parsePdfsig(report) {
  const blocks=String(report).split(/(?=^\s*Signature #\d+:)/m)
    .filter(block=>/^\s*Signature #\d+:/m.test(block) &&
      !/The signature form field is not signed\./i.test(block));
  const signatures=blocks.map(block=>{
    const signer=block.match(/Signer Certificate Common Name:\s*(.+)/i)?.[1]?.trim()||'';
    const time=block.match(/Signing Time:\s*(.+)/i)?.[1]?.trim()||'';
    const integrity=block.match(/Signature Validation:\s*(.+)/i)?.[1]?.trim()||'';
    const certificate=block.match(/Certificate Validation:\s*(.+)/i)?.[1]?.trim()||'';
    const fullDocument=/^\s*- Total document signed\s*$/mi.test(block);
    const valid=/^Signature is Valid\.?$/i.test(integrity);
    const trusted=/^Certificate is Trusted\.?$/i.test(certificate);
    return {signer,time,integrity,certificate,fullDocument,valid,trusted};
  });
  return {signed:signatures.length>0,signatures,
    verified:signatures.length>0&&signatures.every(item=>item.valid&&item.trusted)&&
      signatures.at(-1).fullDocument};
}

async function command(bin,args,timeout=60000,acceptFailure=()=>false) {
  try {return (await execFileAsync(bin,args,{timeout,maxBuffer:2*1024*1024,
    env:{...process.env,LC_ALL:'C'}})).stdout;}
  catch(error){
    const stdout=String(error.stdout||'');
    if(acceptFailure(error,stdout,String(error.stderr||''))) return stdout;
    if(error.code==='ENOENT'){
      const failure=new Error(`A PDF-ellenőrző eszköz nincs telepítve: ${bin}.`);
      failure.pdfTool=path.basename(bin);
      throw failure;
    }
    const diagnostic=String(error.stderr||stdout).replace(/\/tmp\/kocka-pdf-[^/\s]+\/(?:source|archival)\.pdf/gi,'[PDF]')
      .replace(/[\x00-\x1f\x7f]+/g,' ').trim().slice(-600);
    const failure=new Error(`A PDF-ellenőrző eszköz hibát jelzett: ${bin}`+
      (typeof error.code==='number' ? ` (kilépési kód: ${error.code}).` : '.')+
      (process.env.PDF_SMOKE_DIAGNOSTICS==='1'&&diagnostic?' '+diagnostic:''));
    failure.pdfTool=path.basename(bin);
    failure.pdfDiagnostic=diagnostic;
    throw failure;
  }
}

function acceptVeraPdfFailure(error,stdout) {
  return error.code===1 && /<validationReport\b/i.test(stdout);
}

function acceptPdfsigFailure(error,stdout,stderr='') {
  const report=stdout+'\n'+stderr;
  return Boolean(
    (error.code===2 && /(?:does not contain any signatures|no signatures found)/i.test(report)) ||
    (error.code===1 && /^Digital Signature Info of:/m.test(report) &&
      /^Signature #\d+:/m.test(report)));
}

function pdfsigReport(file) {
  return command(process.env.PDFSIG_BIN||'pdfsig',['-no-ocsp',file],60000,acceptPdfsigFailure);
}

async function withPdf(bytes,work) {
  const input=Buffer.from(bytes||[]);
  if(input.length<8||input.length>MAX_PDF_BYTES||input.subarray(0,5).toString()!=='%PDF-')
    throw new Error('A PDF hiányzik, hibás vagy meghaladja a 30 MB-os ellenőrzési korlátot.');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kocka-pdf-'));
  try {const source=path.join(directory,'source.pdf');await fs.writeFile(source,input);
    return await work(source,directory);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
}

async function validateFile(file,flavour='') {
  const args=flavour?['-f',flavour,file]:[file];
  return parseVeraPdf(await command(process.env.VERAPDF_BIN||'verapdf',args,120000,
    acceptVeraPdfFailure));
}

async function inspectPdf(bytes) {
  return withPdf(bytes,async file=>{
    const [pdfa,rawSignature]=await Promise.all([
      validateFile(file),pdfsigReport(file)
    ]);
    return {pdfa,signature:parsePdfsig(rawSignature)};
  });
}

async function convertPdfA(bytes) {
  return withPdf(bytes,async (source,directory)=>{
    const before=parsePdfsig(await pdfsigReport(source));
    if(before.signed) throw new Error('Aláírt PDF nem konvertálható az aláírás sérülése nélkül.');
    const output=path.join(directory,'archival.pdf');
    const definition=path.join(__dirname,'pdfa_def.ps');
    await command(process.env.GHOSTSCRIPT_BIN||'gs',[
      '--permit-file-read=/usr/share/color/icc/ghostscript/srgb.icc',
      '-dBATCH','-dNOPAUSE','-dSAFER','-dPDFA=2','-dPDFACompatibilityPolicy=2',
      '-sDEVICE=pdfwrite','-sColorConversionStrategy=RGB',
      '-sProcessColorModel=DeviceRGB',`-sOutputFile=${output}`,definition,source
    ],120000);
    const result=await validateFile(output,'2b');
    if(!result.compliant) throw new Error('Az előállított PDF nem felel meg a PDF/A-2b szabványnak.');
    const converted=await fs.readFile(output);
    if(!converted.length||converted.length>MAX_PDF_BYTES)
      throw new Error('A PDF/A kimenet üres vagy túl nagy.');
    return converted;
  });
}

async function standardizePdf(bytes) {
  const result=await inspectPdf(bytes);
  if(result.pdfa.compliant) return Buffer.from(bytes);
  if(result.signature.signed)
    throw new Error('Az aláírt PDF nem PDF/A; az eredeti fájl nem módosítható aláírásvesztés nélkül.');
  return convertPdfA(bytes);
}

module.exports={parseVeraPdf,parsePdfsig,acceptVeraPdfFailure,acceptPdfsigFailure,
  inspectPdf,convertPdfA,standardizePdf};
