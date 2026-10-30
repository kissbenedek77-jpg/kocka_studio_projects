'use strict';
const PREFIX = 'KOCKA_MERGE_';

function documentValues(data, extras = {}) {
  const values = {
    UID:data.uid || '', 'Vezetéknév':data.vezeteknev || '',
    Keresztnév:data.keresztnev || '',
    'Teljes név':[data.vezeteknev,data.keresztnev].filter(Boolean).join(' '),
    'Születési név':data.szuletesiNev || '',
    'Állampolgárság':data.allampolgarsag || '',
    lakcim_cim:data.lakcim || '',ertesitesi_cim:data.ertesitesiCim || '',
    Adóazonosító:String(data.adoazonosito || '').replace(/\D/g,''),
    Telefon:data.telefon || '', 'Email cím':data.email || '',
    'Anyja neve':data.anyjaNeve || '', 'Születési hely':data.szuletesiHely || '',
    'Születési idő':data.szuletesiIdo || '',
    Neve:data.projektTipus === 'Egyéb' ? data.projektTipusEgyeb || '' : data.projektTipus || '',
    'projekt Irányítószám':data.projekt_irsz || '',
    'projekt Város':data.projekt_varos || '',
    'projekt Közterület':data.projekt_kozterulet || '',
    'projekt Típus':data.projekt_tipus || '',
    'projekt Házszám':data.projekt_hazszam || '',
    'projekt Egyéb':data.projekt_egyeb || '',
    projekt_cim:data.projektCim || '', Hrsz:data.hrsz || '',
    'Projekt azonosító':[data.projekt_varos,data.projekt_kozterulet,
      data.projekt_tipus,data.projekt_hazszam].filter(Boolean).join(' ').replace(/\s+/g,' ').trim(),
    'Mai dátum':new Intl.DateTimeFormat('hu-HU',{timeZone:'Europe/Budapest',
      year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  };
  for (const [key,value] of Object.entries(extras)) if (!(key in values)) values[key] = value;
  return values;
}

// A sablonban előforduló összes {{...}} jelölő, táblázatcellán belüli jelöléssel.
// A műszaki leírás összeállítása ebből tudja, mely mezőket kell mindenképpen
// kitöltenie (üresen vagy hiányjelöléssel), hogy a kész példányban ne maradjon
// nyers {{...}}.
function templateMarkers(document) {
  const markers = [];
  function scan(contents, inTable) {
    for (const item of contents || []) {
      const text = (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
      for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g))
        markers.push({key:match[1],inTable});
      if (item.table) for (const row of item.table.tableRows || [])
        for (const cell of row.tableCells || []) scan(cell.content,true);
      if (item.tableOfContents) scan(item.tableOfContents.content,inTable);
    }
  }
  scan(document.body?.content,false);
  for (const segment of Object.values(document.headers || {})) scan(segment.content,false);
  for (const segment of Object.values(document.footers || {})) scan(segment.content,false);
  return markers;
}

function findMarkers(document, values, {allowUnknown = false,allowConditional = false} = {}) {
  if (document.tabs?.length > 1)
    throw new Error('A többfüles Google Docs sablon Node-os szinkronja még nem támogatott.');
  const found = [];
  function scan(contents, segmentId = '') {
    for (const item of contents || []) {
      const paragraphText = (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
      if (!allowConditional && /\{\{(?:#IF\b|\/IF\b)/.test(paragraphText))
        throw new Error('A sablon feltételes blokkjai még a meglévő Apps Scriptben kezelhetők.');
      for (const part of item.paragraph?.elements || []) {
        const content = part.textRun?.content || '';
        const regex = /\{\{([^{}]+)\}\}/g;
        let match;
        while ((match = regex.exec(content))) {
          const key = match[1];
          if (allowConditional && (/^#IF\b/.test(key) || key === '/IF')) continue;
          if (!(key in values)) {
            if (allowUnknown) continue;
            throw new Error('Ismeretlen dokumentumsablon-mező: ' + key);
          }
          found.push({key,range:{startIndex:part.startIndex + match.index,
            endIndex:part.startIndex + match.index + match[0].length,
            ...(segmentId ? {segmentId} : {})}});
        }
      }
      if (item.table) for (const row of item.table.tableRows || [])
        for (const cell of row.tableCells || []) scan(cell.content, segmentId);
      if (item.tableOfContents) scan(item.tableOfContents.content, segmentId);
    }
  }
  scan(document.body?.content);
  for (const [id, header] of Object.entries(document.headers || {})) scan(header.content,id);
  for (const [id, footer] of Object.entries(document.footers || {})) scan(footer.content,id);
  return found;
}

function mergeRequests(document, values, options = {}) {
  const markers = findMarkers(document, values, options);
  const existing = new Set(Object.keys(document.namedRanges || {}).filter(name => name.startsWith(PREFIX))
    .map(name => name.slice(PREFIX.length)));
  const requests = markers.filter(item => !existing.has(item.key))
    .map(item => ({createNamedRange:{name:PREFIX+item.key,range:item.range}}));
  const keys = new Set([...markers.map(item => item.key),...existing]);
  for (const key of keys) {
    if (!(key in values) && !options.restoreMissing) continue;
    requests.push({replaceNamedRangeContent:{
      namedRangeName:PREFIX+key,
      text:key in values ? (String(values[key] ?? '') || '\u200B') : `{{${key}}}`
    }});
  }
  return requests;
}

function unresolvedMarkers(document) {
  const result = new Set();
  function scan(content) {
    for (const item of content || []) {
      const text = (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
      for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g))
        if (!/^#IF\b/.test(match[1]) && match[1] !== '/IF') result.add(match[1]);
      if (/ELLENŐRIZENDŐ/i.test(text)) result.add('ellenőrizendő szöveg');
      for (const match of text.matchAll(/\[KIEGÉSZÍTENDŐ:?\s*([^\]]*)\]/gi)) {
        const note = match[1].trim().replace(/\s+/g,' ');
        result.add(note ? 'kiegészítendő: '+note : 'kiegészítendő adat');
      }
      for (const row of item.table?.tableRows || [])
        for (const cell of row.tableCells || []) scan(cell.content);
    }
  }
  scan(document.body?.content);
  for (const segment of Object.values(document.headers || {})) scan(segment.content);
  for (const segment of Object.values(document.footers || {})) scan(segment.content);
  return [...result];
}

module.exports = {PREFIX, documentValues, templateMarkers, findMarkers, mergeRequests, unresolvedMarkers};
