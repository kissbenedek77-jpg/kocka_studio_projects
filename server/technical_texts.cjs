'use strict';

// A műszaki leírás hosszú, alapértelmezett fejezetszövegei a sablon dokumentum
// végén, jelölt blokkokban élnek. A generátor innen olvassa ki őket, a bennük
// lévő {{...}} jelölőket a projekt adataival tölti ki, majd az appendixet a kész
// példányból törli. Így a szöveg egy helyen, a sablonban szerkeszthető, a
// felületen viszont már a kitöltött változat jelenik meg alapértékként.
const HEADING = 'SABLONSZÖVEGEK';
// blokknév → a műszaki adatlap mezőkulcsa
const BLOCKS = {
  TUZVEDELMI: 'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG',
  SZERKEZETEK: 'SZERKEZETEK LEÍRÁSA',
  NYILATKOZAT: 'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'
};
const GAP = '[KIEGÉSZÍTENDŐ:';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function textTemplates(document) {
  const templates = {};
  let open = null, buffer = [];
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    const text = paragraphText(item);
    const start = text.trim().match(/^\[\[([A-Z]+)\]\]$/);
    if (start && BLOCKS[start[1]]) {
      open = start[1];
      buffer = [];
      continue;
    }
    if (open && text.trim() === '[['+'/'+open+']]') {
      templates[BLOCKS[open]] = buffer.join('').replace(/\n$/,'').trim();
      open = null;
      buffer = [];
      continue;
    }
    if (open) buffer.push(text);
  }
  return templates;
}

function renderTemplate(text, values = {}) {
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g,(marker,key) => {
    const value = values[key];
    return value === undefined || value === null || !String(value).trim()
      ? GAP+' '+key+'.]' : String(value);
  });
}

function templateDefaults(templates, values = {}) {
  return Object.fromEntries(Object.entries(templates || {})
    .map(([key,text]) => [key,renderTemplate(text,values)]));
}

// Az appendix a dokumentum végén van; a fejlécétől a test végéig töröljük.
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

module.exports = {HEADING,BLOCKS,textTemplates,renderTemplate,templateDefaults,appendixRequests};
