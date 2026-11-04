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

// A dokumentum bekezdései a nyers szövegükkel (a bekezdésválasztó is benne van),
// hogy a névre szóló tartomány tartalmát pontosan, az üres bekezdéseket is
// megtartva lehessen kiolvasni.
function bodyParagraphs(document) {
  return (document?.body?.content || []).filter(item => item.paragraph).map(item => {
    const startIndex = Number.isInteger(item.startIndex) ? item.startIndex
      : item.paragraph.elements?.[0]?.startIndex;
    return {startIndex, text:paragraphText(item)};
  }).filter(item => Number.isInteger(item.startIndex));
}

// A tartomány szövege a bekezdések nyers szövegéből, a bekezdésválasztókkal
// együtt. Így a szövegben lévő üres sorok (két bekezdésválasztó) megmaradnak,
// csak a tartomány határán lévő felesleges sorválasztókat vágjuk le.
function rangeText(paragraphs, range) {
  const start = Number(range?.startIndex);
  const end = Math.max(start,Number(range?.endIndex) || start);
  if (!Number.isFinite(start)) return '';
  const parts = [];
  for (const item of paragraphs) {
    if (item.startIndex + item.text.length <= start || item.startIndex >= end) continue;
    const from = Math.max(0,start - item.startIndex);
    const to = Math.min(item.text.length,end - item.startIndex);
    if (to < from) continue;
    parts.push(item.text.slice(from,to));
  }
  return parts.join('').replace(/^\n+/,'').replace(/\s+$/,'');
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

// A sablonban a helyőrző bekezdés félkövér stílusát a beszúrt szöveg örökli.
// A szerkezetek leírásának bekezdései nem félkövérek, ezért a tartományon
// kikapcsoljuk a félkövér stílust.
function sectionStyleRequests(document, key = 'SZERKEZETEK LEÍRÁSA') {
  const name = rangeNameFor(key);
  if (!name) return [];
  const ranges = (document?.namedRanges?.[name]?.namedRanges || [])
    .flatMap(item => item.ranges || []);
  return ranges.filter(range => Number.isInteger(range.startIndex) &&
    Number.isInteger(range.endIndex) && range.endIndex > range.startIndex)
    .map(range => ({updateTextStyle:{
      range:{startIndex:range.startIndex,endIndex:range.endIndex},
      textStyle:{bold:false},fields:'bold'}}));
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

// A sablonból készült DRAFT-ban a fejezet-tartományok (KOCKA_SZOVEG_*) jelen
// vannak. Ha hiányoznak, a példány korábbi sablonból készült, ezért a
// rétegrendek és a fejezetszövegek nem frissülnének benne.
function hasTemplateSections(document) {
  return Boolean(document?.namedRanges?.[RANGE_PREFIX+'SZERKEZETEK']);
}

// A rétegrend-szakasz formázása: a blokk címsora aláhúzott. A rétegsorokban a
// mennyiség és a megnevezés tabulátorral tagolva, a tervlap oszlopai szerint.
const RETEGREND_TITLE = /^[FLPMTK]\d{0,2}[a-z]?\s+\S/;
const RETEGREND_SECTION = /^Rétegrendek\b/i;
const RETEGREND_END = /^(?:Tervezői nyilatkozat|Kitermelt ásványi|Építési hulladék|A kivitelezés|Felhasznált)/i;

function retegrendStyleRequests(document) {
  const requests = [];
  let inside = false;
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    const value = paragraphText(item).replace(/\r?\n$/,'');
    if (!inside) {
      if (RETEGREND_SECTION.test(value)) inside = true;
      continue;
    }
    if (RETEGREND_END.test(value)) break;
    if (item.paragraph.bullet ||
        /^HEADING/.test(item.paragraph.paragraphStyle?.namedStyleType || '')) break;
    const start = Number.isInteger(item.startIndex) ? item.startIndex
      : item.paragraph.elements?.[0]?.startIndex;
    const end = Number.isInteger(item.endIndex) ? item.endIndex : null;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue;
    if (RETEGREND_TITLE.test(value)) {
      requests.push({updateTextStyle:{range:{startIndex:start,endIndex:end - 1},
        textStyle:{underline:true},fields:'underline'}});
    } else if (value.trim()) {
      // A sablon helyőrzőjének aláhúzása a beszúrt rétegsorokra is átöröklődik.
      requests.push({updateTextStyle:{range:{startIndex:start,endIndex:end - 1},
        textStyle:{underline:false},fields:'underline'}});
    }
  }
  return requests;
}

module.exports = {HEADING,RANGE_PREFIX,SECTION_RANGES,SECTION_KEYS,textTemplates,renderTemplate,
  sectionTexts,rangeNameFor,sectionReplaceRequests,sectionStyleRequests,hasTemplateSections,
  retegrendStyleRequests,appendixRequests};
