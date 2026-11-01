'use strict';

// A műszaki leírás alapértelmezett fejezet- és alpontszövegei a sablon
// dokumentumban, a helyükön élnek. A generátor a névre szóló tartományokból
// (KOCKA_SZOVEG_*) olvassa ki őket, a {{...}} jelölőket a projekt adataival
// tölti ki, és a kész példányban a tartomány tartalmát a végleges szövegre
// cseréli. Így a szöveget a sablonban kell módosítani, a kód nem tartalmaz
// alapértelmezett fejezetszöveget.
const RANGE_PREFIX = 'KOCKA_SZOVEG_';
// tartománynév → a műszaki adatlap mezőkulcsa
const SECTION_RANGES = {
  PROGRAM_A:'TERVEZESI_PROGRAM:a',
  PROGRAM_B:'TERVEZESI_PROGRAM:b',
  PROGRAM_C:'TERVEZESI_PROGRAM:c',
  PROGRAM_D:'TERVEZESI_PROGRAM:d',
  PROGRAM_E:'TERVEZESI_PROGRAM:e',
  PROGRAM_F:'TERVEZESI_PROGRAM:f',
  PROGRAM_G:'TERVEZESI_PROGRAM:g',
  PROGRAM_H:'TERVEZESI_PROGRAM:h',
  PROGRAM_I:'TERVEZESI_PROGRAM:i',
  PROGRAM_J:'TERVEZESI_PROGRAM:j',
  PROGRAM_K:'TERVEZESI_PROGRAM:k',
  PROGRAM_L:'TERVEZESI_PROGRAM:l',
  PROGRAM_M:'TERVEZESI_PROGRAM:m',
  PROGRAM_N:'TERVEZESI_PROGRAM:n',
  PROGRAM_O:'TERVEZESI_PROGRAM:o',
  PROGRAM_P:'TERVEZESI_PROGRAM:p',
  TUZVEDELMI:'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG',
  SZERKEZETEK:'SZERKEZETEK LEÍRÁSA',
  NYILATKOZAT:'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'
};
// A fejezetszöveg-mezők (ezek alapértéke a sablonból jön).
const SECTION_KEYS = Object.values(SECTION_RANGES);
// A régi sablon appendixe ([[TUZVEDELMI]] … [[/NYILATKOZAT]]); a régi
// példányokból ezt a részt kell törölni.
const HEADING = 'SABLONSZÖVEGEK';
const LEGACY_BLOCKS = {
  TUZVEDELMI:'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG',
  SZERKEZETEK:'SZERKEZETEK LEÍRÁSA',
  NYILATKOZAT:'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'
};
const GAP = '[KIEGÉSZÍTENDŐ:';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function renderTemplate(text, values = {}) {
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g,(marker,key) => {
    const value = values[key];
    return value === undefined || value === null || !String(value).trim()
      ? GAP+' '+key+'.]' : String(value);
  });
}

// A régi appendix blokkjai (visszafelé kompatibilitás a korábbi sablonhoz).
function textTemplates(document) {
  const templates = {};
  let open = null, buffer = [];
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    const text = paragraphText(item);
    const start = text.trim().match(/^\[\[([A-Z]+)\]\]$/);
    if (start && LEGACY_BLOCKS[start[1]]) {
      open = start[1];
      buffer = [];
      continue;
    }
    if (open && text.trim() === '[['+'/'+open+']]') {
      templates[LEGACY_BLOCKS[open]] = buffer.join('').replace(/\n$/,'').trim();
      open = null;
      buffer = [];
      continue;
    }
    if (open) buffer.push(text);
  }
  return templates;
}

// A dokumentum bekezdései indexszel, hogy a névre szóló tartomány tartalmát
// (esetleg több bekezdésen át) ki lehessen olvasni.
function bodyParagraphs(document) {
  return (document?.body?.content || []).filter(item => item.paragraph).map(item => ({
    startIndex:item.startIndex,
    endIndex:item.endIndex,
    text:paragraphText(item).replace(/\n$/,'')
  }));
}

function rangeText(paragraphs, range) {
  const start = Number(range?.startIndex);
  const end = Math.max(start,Number(range?.endIndex) || start);
  if (!Number.isFinite(start)) return '';
  const parts = [];
  for (const item of paragraphs) {
    if (item.endIndex <= start || item.startIndex >= end) continue;
    const from = Math.max(0,start - item.startIndex);
    const to = Math.min(item.text.length,end - item.startIndex);
    if (to <= from) continue;
    parts.push(item.text.slice(from,to));
  }
  return parts.join('\n').trim();
}

// A sablonban a helyükön álló alapértelmezett szövegek mezőkulcs szerint.
function sectionTexts(document) {
  const paragraphs = bodyParagraphs(document);
  const result = {};
  for (const [rangeId,key] of Object.entries(SECTION_RANGES)) {
    const name = RANGE_PREFIX+rangeId;
    const ranges = (document?.namedRanges?.[name]?.namedRanges || [])
      .flatMap(item => item.ranges || []);
    if (!ranges.length) continue;
    const text = ranges.map(range => rangeText(paragraphs,range)).filter(Boolean).join('\n');
    if (text) result[key] = text;
  }
  return result;
}

// A névre szóló tartomány neve a mezőkulcshoz.
function rangeNameFor(key) {
  for (const [rangeId,fieldKey] of Object.entries(SECTION_RANGES))
    if (fieldKey === key) return RANGE_PREFIX+rangeId;
  return '';
}

// A kész példányban a sablon alapértelmezett szövegét a végleges szövegre
// cseréljük. A tartomány csak a sablonból készült példányban létezik; ha nincs,
// nincs mit cserélni.
function sectionReplaceRequests(document, values = {}) {
  const named = document?.namedRanges || {};
  const requests = [];
  for (const [rangeId,key] of Object.entries(SECTION_RANGES)) {
    const name = RANGE_PREFIX+rangeId;
    if (!named[name]) continue;
    requests.push({replaceNamedRangeContent:{namedRangeName:name,
      text:String(values[key] ?? '').trim() || '\u200B'}});
  }
  return requests;
}

// A régi appendix a dokumentum végén van; a fejlécétől a test végéig töröljük.
function appendixRequests(document) {
  const content = document?.body?.content || [];
  const index = content.findIndex(item => item.paragraph &&
    paragraphText(item).trim().toUpperCase().startsWith(HEADING));
  if (index < 0) return [];
  const start = content[index].startIndex;
  const last = content[content.length-1];
  const end = Math.max(start, (last?.endIndex || start+1) - 1);
  return end > start ? [{deleteContentRange:{range:{startIndex:start,endIndex:end}}}] : [];
}

module.exports = {HEADING,RANGE_PREFIX,SECTION_RANGES,SECTION_KEYS,textTemplates,renderTemplate,
  sectionTexts,rangeNameFor,sectionReplaceRequests,appendixRequests};
