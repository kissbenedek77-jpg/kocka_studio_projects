'use strict';

// A tervlap léptéke elsődlegesen a tervlapon olvasható „M = 1:XXX” feliratból
// származik. A fájlnév csak tartalék: ha a PDF szövege nem olvasható, vagy nincs
// benne léptékfelirat, a fájlnév kulcsszava ad becsült értéket, és erről a hívó
// figyelmeztetést ír a tervlap nevével.
const {pdfToText} = require('./pdf_text.cjs');

// „M = 1:200”, „M=1:200”, „M = 1 : 50” stb. Az XXX helyén változó szám állhat.
// Egy tervlapon több lépték is szerepelhet (például „M = 1:500, 1:200”); ilyenkor
// a felirat egésze a lépték, ahogy a tervlap címszóblokkja tartalmazza.
const SCALE_PATTERN = new RegExp(
  'M\\s*=\\s*(1\\s*:\\s*\\d+(?:[.,]\\d+)?'+
  '(?:\\s*[,;]\\s*1\\s*:\\s*\\d+(?:[.,]\\d+)?)*)','gi');

function normalizeScale(inscription) {
  return 'M=' + String(inscription)
    .replace(/\s*[,;]\s*(?=1\s*:)/g,', ')
    .replace(/\s*:\s*/g,':')
    .trim();
}

function scaleFromText(text) {
  const counts = new Map();
  let first = '';
  for (const match of String(text || '').matchAll(SCALE_PATTERN)) {
    const value = normalizeScale(match[1]);
    if (!value || value === 'M=') continue;
    if (!first) first = value;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  // Ha egy tervlapon több léptékfelirat van, a leggyakoribb a jellemző; holtverseny
  // esetén az első előfordulás marad.
  let best = '', bestCount = 0;
  for (const [value, count] of counts)
    if (count > bestCount) { best = value; bestCount = count; }
  return best || first;
}

// A fájlnév kulcsszava csak tartalék. A kulcsszóhoz tartozó érték becslés.
const SCALE_BY_KEYWORD = {
  'helyszínrajz':'M=1:200','alaprajza':'M=1:50','alaprajz':'M=1:50','tető':'M=1:50',
  'metszet':'M=1:50','homlokzat':'M=1:50','idomterv':'M=1:500, 1:200',
  'geodézia':'M=1:200','tervezési':'M=1:200','konszignáció':'M=1:20, 1:50',
  'részlet':'M=1:5, 1:10','kerítés':'M=1:50'
};
const KEYWORD_ORDER = ['konszignáció','részlet','idomterv','helyszínrajz','geodézia',
  'tervezési','alaprajza','alaprajz','tető','metszet','homlokzat','kerítés'];

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'');
}

// A tervlap címe (fájlnév kiterjesztés nélkül) alapján becsült lépték.
function planScale(title) {
  const name = normalize(title);
  const keyword = KEYWORD_ORDER.find(item => name.includes(normalize(item)));
  return keyword ? SCALE_BY_KEYWORD[keyword] : '';
}

// A lépték feloldása: előbb a tervlap szövege, utána a fájlnév.
// source: 'pdf' (a tervlapról olvasott felirat), 'name' (fájlnév-becslés),
// '' (nem állapítható meg). Az assumed jelzi a becslést.
function resolvePlanScale(title, pdfText) {
  const fromText = scaleFromText(pdfText);
  if (fromText) return {scale:fromText, source:'pdf', assumed:false};
  const fromName = planScale(title);
  if (fromName) return {scale:fromName, source:'name', assumed:true};
  return {scale:'', source:'', assumed:false};
}

// A becsült vagy hiányzó lépték figyelmeztetése: mindig nevezi meg a tervlapot,
// becslés esetén a feltételezett léptéket is.
function planScaleWarning(title, resolved, problem = '') {
  const suffix = problem ? ' ('+problem+')' : '';
  if (resolved?.assumed)
    return 'A(z) „'+title+'” tervlapon nem található „M = 1:XXX” léptékfelirat'+suffix+
      '; a fájlnév alapján feltételezett lépték: '+resolved.scale+'. Ellenőrizd a tervlapon.';
  if (!resolved?.scale)
    return 'A(z) „'+title+'” tervlapon nem található „M = 1:XXX” léptékfelirat'+suffix+
      ', és a fájlnévből sem állapítható meg, ezért a tervjegyzékben lépték nélkül szerepel.';
  return '';
}

// PDF-ből kiolvasott lépték. Ha a szövegolvasó nem elérhető, üres az eredmény,
// és a hívó a fájlnévre vált.
async function extractPdfScale(pdfBytes) {
  if (!pdfBytes || !pdfBytes.length) return '';
  try { return scaleFromText(await pdfToText(Buffer.from(pdfBytes))); }
  catch { return ''; }
}

module.exports = {planScale, scaleFromText, resolvePlanScale, planScaleWarning,
  extractPdfScale};
