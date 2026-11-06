'use strict';

// A műszaki leírás sablonjában a helyükön álló, nem {{...}} jelölőből származó
// szövegek szerkeszthető blokkjai. A blokk azonosítója a bekezdés sorszáma a
// dokumentum törzsében (b0, b1, ...), így a sablonból készült példányban
// ugyanaz a bekezdés található meg. A felület a blokkokat a dokumentum
// sorrendjében, fejezetekbe rendezve jeleníti meg.
const {SECTION_RANGES} = require('./technical_texts.cjs');

const BLOCK_SHEET = '_MűszakiSzövegek';
const BLOCK_HEADER = ['Blokk','Szöveg','Eredeti','Frissítve'];
const BLOCK_ID = /^b\d+$/;
const AUTO_LABELS = {
  TERVJEGYZEK:'A tervjegyzék a PDFA mappa tervlapjaiból automatikusan készül.',
  BEEPITESI_MERLEG:'A beépítési mérleg a tervezési adatokból automatikusan készül.',
  ADAT_EGYEZTETES:'Az adategyeztetés a tervezési adatokból automatikusan készül.',
  PARKOLOEGYENLEG_ERTEKELES:'A parkolóegyenleg a tervezési adatokból automatikusan készül.'
};

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function normalizedText(item) {
  return paragraphText(item).replace(/\r?\n$/,'');
}

function markerKeys(text) {
  return [...String(text || '').matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]);
}

// Az automatikus szöveg előnézete: az ismert projektadatokat behelyettesíti,
// az ismeretlen jelölőket viszont meghagyja, hogy a felület jelezhesse őket.
function previewText(text, values = {}) {
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g,(all,key) => {
    const value = values?.[key];
    return value === undefined || value === null || !String(value).trim()
      ? all : String(value);
  });
}

function tableFieldKeys(table, manual) {
  const keys = new Set();
  const scan = contents => {
    for (const item of contents || []) {
      if (item.paragraph)
        for (const key of markerKeys(paragraphText(item)))
          if (manual.has(key)) keys.add(key);
      if (item.table) for (const row of item.table.tableRows || [])
        for (const cell of row.tableCells || []) scan(cell.content);
    }
  };
  for (const row of table?.tableRows || [])
    for (const cell of row.tableCells || []) scan(cell.content);
  return [...keys];
}

function isSectionHeading(item) {
  const style = item.paragraph?.paragraphStyle?.namedStyleType || '';
  return Boolean(item.paragraph?.bullet) || style === 'HEADING_3';
}

// A KOCKA_SZOVEG_* névre szóló tartományok: ezek a fejezetszöveg-mezők helyei.
function sectionRanges(document) {
  const result = [];
  for (const [rangeId,key] of Object.entries(SECTION_RANGES)) {
    const name = 'KOCKA_SZOVEG_'+rangeId;
    for (const item of document?.namedRanges?.[name]?.namedRanges || []) {
      for (const range of item.ranges || []) {
        if (Number.isInteger(range.startIndex) && Number.isInteger(range.endIndex))
          result.push({key,name,startIndex:range.startIndex,endIndex:range.endIndex});
      }
    }
  }
  return result.sort((a,b) => a.startIndex - b.startIndex);
}

// A dokumentum bekezdései a törzs sorrendjében, a táblázatokkal együtt.
function bodyItems(document) {
  const items = [];
  let ordinal = 0;
  for (const item of document?.body?.content || []) {
    if (item.paragraph) {
      const text = normalizedText(item);
      items.push({kind:'paragraph',item,ordinal,text,startIndex:item.startIndex,
        endIndex:item.endIndex,style:item.paragraph?.paragraphStyle?.namedStyleType || '',
        heading:isSectionHeading(item),chapterHeading:Boolean(item.paragraph?.bullet)});
      ordinal++;
    } else if (item.table) {
      items.push({kind:'table',item});
    } else if (item.tableOfContents) {
      items.push({kind:'toc',item});
    }
  }
  return items;
}

// A sablon szerkeszthető kirajzolása. A visszaadott entries a dokumentum
// sorrendjében tartalmazza a címeket, a fix szövegblokkokat, a mezőket és a
// csak olvasható automatikus szövegeket.
// A fejezetszámok a dokumentum bulleted főcímei szerint. A címoldal és a
// tartalomjegyzék a 0. fejezet; az 1., 3., 5., 10., 11. fejezet tényszerű adat,
// ezért csak olvasható. A 4. fejezet saját építményérték-táblázatot kap.
const READONLY_CHAPTERS = new Set([0,1,3,5,10,11]);
const VALUE_TABLE_FIELDS = ['EPITMENYERTEK:terulet_1_m2','EPITMENYERTEK:terulet_5_m2',
  'EPITMENYERTEK:rendeltetesi_kategoria','EPITMENYERTEK:egysegar_eFt_m2',
  'SZAMITOTT_EPITMENYERTEK','EPITMENYERTEK:jogszabaly_es_modszer'];

function templateOutline(document, {manualKeys = [], values = {}} = {}) {
  const manual = new Set(manualKeys);
  const items = bodyItems(document);
  const paragraphs = items.filter(item => item.kind === 'paragraph');
  const ranges = sectionRanges(document);
  // A névre szóló tartomány mezője annál a bekezdésnél jelenik meg, ahol a
  // tartomány kezdődik. A tartomány teljes szövegét a mező képviseli.
  const rangeAt = new Map();
  for (const range of ranges) {
    if (!manual.has(range.key)) continue;
    const first = paragraphs.find(item => range.startIndex >= item.startIndex &&
        range.startIndex < item.endIndex) ||
      paragraphs.find(item => item.startIndex >= range.startIndex);
    if (first) rangeAt.set(first.ordinal, range);
  }
  const used = new Set();
  const entries = [];
  const blocks = [];
  let chapter = 0;
  for (const item of items) {
    if (item.kind === 'table') {
      if (chapter === 4) continue;
      const readonly = READONLY_CHAPTERS.has(chapter);
      entries.push({type:'table',note:'Táblázat – az adatokat a tervezési adatlapon szerkeszd.',
        chapter,readonly});
      const tableKeys = tableFieldKeys(item.item?.table,manual);
      if (tableKeys.length) {
        entries.push({type:'fields',keys:tableKeys,ordinal:null,context:'Táblázat adatai',
          chapter,readonly});
        if (chapter !== 0)
          tableKeys.forEach(key => used.add(key));
      }
      continue;
    }
    if (item.kind === 'toc') {
      entries.push({type:'note',text:'Tartalomjegyzék',chapter,readonly:true});
      continue;
    }
    if (!item.text.trim()) continue;
    if (item.heading) {
      if (item.chapterHeading) {
        chapter++;
        const regulation = String(values['EPITMENYERTEK:jogszabaly_es_modszer'] || '').trim() ||
          '245/2006. (XII. 5.) Korm. rendelet 1. melléklet';
        const suffix = /szerint\s*$/i.test(regulation) ? '' : ' szerint';
        const text = chapter === 4
          ? `Építményérték számítása (${regulation}${suffix})`
          : item.text;
        entries.push({type:'heading',level:'chapter',number:chapter,text,
          chapter,readonly:true});
        if (chapter === 4) {
          entries.push({type:'valueTable',chapter:4});
          VALUE_TABLE_FIELDS.forEach(key => used.add(key));
        }
      } else {
        entries.push({type:'heading',level:'subheading',text:item.text,
          chapter,readonly:true});
      }
      continue;
    }
    if (chapter === 4) continue;
    const readonly = READONLY_CHAPTERS.has(chapter);
    const range = rangeAt.get(item.ordinal);
    if (range) {
      entries.push({type:'field',key:range.key,ordinal:item.ordinal,context:item.text,
        range:true,chapter,readonly});
      if (chapter !== 0) used.add(range.key);
      continue;
    }
    // A tartomány belső bekezdéseit a fejezetszöveg-mező képviseli.
    if (ranges.some(candidate => manual.has(candidate.key) &&
        item.startIndex >= candidate.startIndex && item.startIndex < candidate.endIndex))
      continue;
    const keys = markerKeys(item.text);
    const fieldKeys = keys.filter(key => manual.has(key));
    if (fieldKeys.length) {
      entries.push({type:'fields',keys:fieldKeys,ordinal:item.ordinal,context:item.text,
        chapter,readonly});
      if (chapter !== 0)
        fieldKeys.forEach(key => used.add(key));
      continue;
    }
    if (keys.length) {
      // Projektadatból kitöltődő szöveg: látszik, de itt nem szerkeszthető.
      const single = item.text.trim().replace(/^\{\{|\}\}$/g,'');
      entries.push({type:'auto',text:item.text,
        preview:AUTO_LABELS[single] || previewText(item.text,values),
        ordinal:item.ordinal,chapter});
      continue;
    }
    const block = {id:'b'+item.ordinal,text:item.text,ordinal:item.ordinal,
      style:item.style,heading:item.heading};
    // A tervezési program a)–p) jelű sorai struktúracímkék, nem szerkeszthetők.
    const blockReadonly = readonly || (chapter === 2 && /^[a-p]\)\s/.test(item.text.trim()));
    if (!blockReadonly) blocks.push(block);
    entries.push({type:item.heading?'heading':'text',...block,readonly:blockReadonly,chapter});
  }
  const missingFields = [...manual].filter(key => !used.has(key));
  return {entries,blocks,missingFields};
}

// A _MűszakiSzövegek lap sorai: blokk-azonosító → felülírt szöveg. Az üres
// értékű sor azt jelenti, hogy a blokkot vissza kell állítani a sablon
// szövegére (a felület „Visszaállítás” gombja).
function blockOverrides(rows) {
  const result = new Map();
  for (const row of rows || []) {
    const id = String(row?.[0] || '').trim();
    if (!BLOCK_ID.test(id)) continue;
    result.set(id, String(row?.[1] ?? '').trim());
  }
  return result;
}

function findTarget(paragraphs, block, desired, cursor) {
  const matches = item => item.text === block.text || item.text === desired;
  if (block.ordinal < paragraphs.length && matches(paragraphs[block.ordinal]))
    return block.ordinal;
  for (let index = cursor; index < paragraphs.length; index++)
    if (matches(paragraphs[index])) return index;
  for (let index = 0; index < paragraphs.length; index++)
    if (matches(paragraphs[index])) return index;
  return -1;
}

// A blokk-felülírásokból dokumentummódosítási kérések. A blokkokat alulról
// felfelé dolgozzuk fel, hogy a szöveghossz változása ne tolja el a még
// feldolgozandó blokkok indexeit.
function blockRequests(document, blocks, overrides) {
  const paragraphs = (document?.body?.content || []).filter(item => item.paragraph)
    .map(item => ({startIndex:item.startIndex,endIndex:item.endIndex,
      text:normalizedText(item)}));
  const found = [];
  let cursor = 0;
  for (const block of blocks || []) {
    if (!overrides?.has?.(block.id)) continue;
    const stored = overrides.get(block.id);
    // Az üres sor visszaállítás: a sablon eredeti szövegét kell visszaírni.
    const desired = stored || block.text;
    let index;
    if (stored) {
      index = findTarget(paragraphs, block, desired, cursor);
    } else {
      // Visszaállításnál a bekezdés sorszáma a biztos támpont, mert a
      // dokumentumban még a korábbi felülírás áll.
      index = block.ordinal < paragraphs.length ? block.ordinal
        : findTarget(paragraphs, block, desired, cursor);
    }
    if (index < 0) continue;
    cursor = index + 1;
    if (paragraphs[index].text === desired) continue;
    found.push({block,paragraph:paragraphs[index],desired});
  }
  found.sort((a,b) => b.paragraph.startIndex - a.paragraph.startIndex);
  const requests = [];
  for (const item of found) {
    const startIndex = item.paragraph.startIndex;
    const endIndex = item.paragraph.endIndex;
    if (endIndex > startIndex)
      requests.push({deleteContentRange:{range:{startIndex,endIndex:endIndex - 1}}});
    requests.push({insertText:{location:{index:startIndex},text:item.desired}});
  }
  return {requests,applied:found.length};
}

module.exports = {BLOCK_SHEET,BLOCK_HEADER,BLOCK_ID,paragraphText,normalizedText,
  markerKeys,previewText,sectionRanges,bodyItems,templateOutline,blockOverrides,blockRequests};
