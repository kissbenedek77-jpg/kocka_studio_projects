'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

/**
 * PDF tartalomból kiolvassa a léptéket/mértékegységet.
 * Visszaadja a terv léptékét, ha sikeres volt, különben üres sztringet.
 * Használja a Ghostscript pdftotext modust (Poppler csomag része).
 * Ha nincs elérhető a Ghostscript, visszaugrás a fájlnév alapú magyarázatra.
 * Ha a tartalomból nem található lépték információ, üssön vissza, és a hívó
 * függvény fallback-ra fog ugrani a fájlnévre.
 */
async function extractPdfScale(pdfBytes) {
  if (!pdfBytes || !pdfBytes.length) return '';
  // Ghostscript használata pdftext kimenetért
  try {
    const {execFile} = require('node:child_process');
    const {promisify} = require('node:util');
    const execFileAsync = promisify(execFile);
    const directory = await fs.mkdtemp(path.join(fs.tmpdir ? fs.tmpdir() : '/tmp', 'kocka-pdf-scale-'));
    const sourcePath = path.join(directory, 'source.pdf');
    await fs.writeFile(sourcePath, pdfBytes);
    // pdftotext kihasználása a lépték kinyeréséhez
    // A tervlapcímszóknak és a léptéknek a szövegben kell lennie
    const {stdout} = await execFileAsync(
      process.env.GHOSTSCRIPT_BIN || 'gs',
      [
        '-dBATCH', '-dNOPAUSE', '-dSAFER',
        '-sDEVICE=pdftotext',
        '-f', sourcePath,
        '-o', path.join(directory, 'output.txt')
      ],
      30000
    );
    await fs.rm(directory, { recursive: true, force: true });
    // A kimenetben keressük a leggyakoribb léptékmintázatot
    const text = stdout || '';
    // Léptékmintázatok: M=1:50, M=1:200, M=1:5 stb.
    const scaleMatch = text.match(/M=1:\d+(\.\d+)?/i);
    if (scaleMatch) return scaleMatch[0];
    // Alternatív mintázat: 1:50, 1:100 stb. (anélkül M= előtaggal)
    const altMatch = text.match(/(?:Lépték|scale|Scale)[:\s]+(M=1:\d+(\.\d+)?|1:\d+(\.\d+)?)/i);
    if (altMatch) return altMatch[1] || altMatch[2];
    // Nem található semmilyen lépték információ a tartalomban
    return '';
  } catch (err) {
    // Ha a Ghostscript vagy pdftotext hibás, üres eredményt adunk vissza
    // (a hívó függvény fallback-ra fog ugrani a fájlnévre)
    try { await fs.rm(path.join(fs.tmpdir ? fs.tmpdir() : '/tmp', 'kocka-pdf-scale-'), { recursive: true, force: true }); } catch {}
    return '';
  }
}

/**
 * A tervlap fájlnévből vagy tartalmából kinyeri a léptéket.
 * ALWAYS megpróbálja először a PDF tartalmából leolvasni a léptéket.
 * Csak ha a tartalomból SEMMILMILYEN lépték információ nem található,
 * ugrál a fájlnév kulcsszó-alapú egyezésére.
 * @param {string} title - A tervlap fájlneve (without .pdf kiterjesztés)
 * @param {Buffer} pdfBytes - Kötelező a PDF binnéjts tartalma byte-ként
 * @returns {string} A lépték/mértékegység (pl. "M=1:200"), vagy üres sztring,
 *                   ha sem a tartalomból, sem a fájlnévből sem ismeri fel
 */
function planScale(title, pdfBytes) {
  // Kötelező: mindig megpróbáljuk a PDF tartalomból olvasni a léptéket
  // (ha válaszadásra ígértük, hogy kötelező a tartalom-olvasás)
  let contentScale = '';
  try {
    if (pdfBytes && pdfBytes.length) {
      contentScale = await extractPdfScale(pdfBytes);
    }
  } catch (extractErr) {
    // Hiba a tartalom-olvasás során, folytatjuk a fallback-ra
  }
  // Ha a tartalomból sikerült lekerni a léptéket, visszaadjuk
  if (contentScale) return contentScale;
  // Fallback: fájlnév alapján kulcsszó egyezés (csak ha a tartalomból nem találtuk)
  const scaleByKeyword = {
    'helyszínrajz':'M=1:200','alaprajza':'M=1:50','tető':'M=1:50',
    'metszet':'M=1:50','homlokzat':'M=1:50','idomterv':'M=1:500, 1:200',
    'geodézia':'M=1:200','tervezési':'M=1:200','konszignáció':'M=1:20, 1:50',
    'részlet':'M=1:5, 1:10','kerítés':'M=1:50'
  };
  const matchOrder = ['konszignáció','részlet','idomterv','helyszínrajz','geodézia',
    'tervezési','alaprajza','tető','metszet','homlokzat','kerítés'];
  const normalized = text => String(text || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'');
  const name = normalized(title || '');
  const keyword = matchOrder.find(item => name.includes(normalized(item)));
  return keyword ? scaleByKeyword[keyword] : '';
}
module.exports = {planScale, extractPdfScale};
