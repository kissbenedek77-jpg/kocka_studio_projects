'use strict';

// Rétegrend-feldolgozás. A bemenet a „Rétegrend sablonok” munkalap soraiból
// és/vagy a Metszetek tervlap „Rétegrendek” szövegblokkjából származik. A
// generátor ebből nyeri a fal-, födém- és fedélszerkezet anyagát és
// vastagságát; hiányzó adat helyén hiányjelölés marad, anyagot nem találunk ki.
//
// A Metszetek tervlapján a rétegrendek egyetlen, jól körülhatárolható
// szövegblokkban vannak. A blokk a „Rétegrendek:” címsorral kezdődik, és a
// következő címsorig, az „É” jelölésig vagy a rajzi megjegyzések kezdetéig tart.
// Ezen kívül eső szöveget nem használunk fel: a rajzi feliratok, a méretek és a
// tervjegyzék nem lesznek rétegek.
//
// A blokkon belül a rétegek sorrendje a nyers pdftotext-kimenetből jön (a
// vastagság és az anyag egymást követi). A `-layout` kimenet csak arra kell,
// hogy az egyetlen összefolyó anyagsorból az egyes anyagokat szétválasszuk;
// az oszlop helyét a leggyakoribb vastagság-token kezdőpozíciója adja meg.
const GAP = '[KIEGÉSZÍTENDŐ:';

const TH_SRC = '(?:(?:min\\.?)\\s*)?\\d+(?:\\s*[-–]\\s*\\d+)?(?:[.,]\\d+)?\\s*(?:cm|mm|rtg)|\\d+\\s*\\/\\s*\\d+';
const TH_G = new RegExp(TH_SRC,'gi');
const TH_LEAD = new RegExp('^('+TH_SRC+')\\s+(.+)$','i');
const TH_TRAIL = new RegExp('^(.*?)\\s+((?:(?:'+TH_SRC+')(?:\\s+(?:'+TH_SRC+'))*))$','i');

const CONSTRUCTION = /fal|födém|fodem|fedél|fedel|tető|teto|magastető|magasteto|mennyezet|válaszfal|valaszfal|aljzat|padló|padlo|szerkezet|burkolat|lábazat|labazat|járda|jarda|terasz|pince|lépcső|lepcso|erkély|erkely/i;
const REGION = /r[eé]tegrendek\s*:?/i;
const END = /^(?:[ÉE]$|[±+\-]?\d+[.,]\d+\s*=\s*\d|M\s*=\s*1:|Terven jelölt|Az épület|A bútorok|Az egyes szerkezetek|Minden szerkezet|Minden szín|Rajzszám|Rajz léptéke|KOCKA STÚDIÓ)/i;
const HEADER = /^([FMTPKL])(\d{0,2})([a-z]?)\s+(.+)$/;
const DRAWING_ID = /^[A-Z]{1,3}\d+[a-z]?$/;
const CONTINUATION = /^(?:szalaggal|hajlaterősítő|hajlaterosit|folytatva|átlapolva|atlapolva)\b/i;
const PRIMER = /^(?:hideg\s+bitumenmáz|hideg\s+bitumenmaz|bitumenmáz|bitumenmaz|kellősítés|kellosites|alapozó|alapozo|primer)(?:\s|$)/i;
const ADJECTIVE_END = /(?:i|ő|ű|ú|ó|tett|ott|ett|ált|elt)$/i;
// A rajzlap fejlécében és a széljegyzetekben szereplő sorok sosem rétegek.
const TITLE_BLOCK = /^(?:KOCKA STÚDIÓ|Bőle|Kaposvár|Munka megnevezése|Tervfajta|Rajz név|Rajzszám|Rajz léptéke|Építészet|Statika|Épületgépészet|Épületvillamosság|Kiss László|Márton Attila|Mácsai|Kocsis|M = 1:|Kiviteli terv|Metszetek|\d{4}\.\d{2}\.\d{2}\.|Minden szerkezet|Minden szín|ellenőrizendők!|glettelés és diszperziós festés készül|Terven jelölt|Az épület|A bútorok|Az egyes szerkezetek)/i;

// A szerkezeti réteg kiválasztása típusonként. A hőszigetelés, a vakolat, a
// glettelés és a burkolat nem szerkezet, ezért kimarad.
const FINISH = /festés|festes|glettelés|gletteles|glettel|vakolat|hőszigetelés|hoszigeteles|\beps\b|\bxps\b|kőzetgyapot|kozetgyapot|üveggyapot|uveggyapot|fólia|folia|párazáró|parazaro|páraáteresztő|paraatereszto|gipszkarton|lécváz|lecvaz|ellenléc|ellenlec|lécezés|lecezes|burkolat|aljzatbeton|esztrich|ragasztó|ragaszto|üvegszövet|uvegszovet|diszperziós|diszperzios|háló|halo/i;
const TYPE_LAYER = {
  wall: /falazat|tégla|tegl|kerámia|keramia|porotherm|ytong|silka|vasbeton|beton|vázkerámia|vazkeramia|kőfal|kofal|blokk|samott/i,
  slab: /vasbeton|\bvb\b|födém|fodem|monolit|előregyártott|eloregyartott|gerenda|béléstest|belestest|acél|fa/i,
  roofFrame: /szaru|fedélszék|fedelszek|szelemen|torokgerenda|gerenda|fa tartó|fa tarto/i,
  roofCover: /fedés|fedes|cserep|cserép|lemez|bitumen|zsindely|nád|hejalas|héjalás|fém|fem/i,
  floor: /aljzat|beton|esztrich|vasalt|szerkezet/i
};

function text(value) {return String(value ?? '').replace(/\s+/g,' ').trim();}
function tokensOf(line) {return text(line).match(TH_G) || [];}

function numericThickness(value) {
  const match = /(\d+(?:[.,]\d+)?)\s*(cm|mm)?/i.exec(text(value));
  if (!match) return null;
  const number = Number(match[1].replace(',','.'));
  return match[2] && /mm/i.test(match[2]) ? number/10 : number;
}

// A blokk besorolása. A pincefal, a lábazat, a járda és a terasz önálló
// szerkezet, ezért nem versenyez a fő határoló fal / födém / fedélszék hellyel.
function classify(block) {
  const title = text(block?.title);
  const all = [title,...(block?.layers || []).map(layer => layer.material)].join(' ');
  if (/terasz/i.test(title)) return 'terrace';
  if (/járda|jarda/i.test(title)) return 'paving';
  if (/pincefal/i.test(title)) return 'basement';
  if (/lábazat|labazat/i.test(title)) return 'plinth';
  // A sorrend fontos: a „Födém” nem határoló fal, a „Magastető” nem födém.
  if (/födém|fodem|födémlemez|fodemlemez/i.test(all)) return 'slab';
  if (/fedél|fedel|magastető|magasteto|tetőhéjalás|tetohejalas|tetőszerkezet|tetoszerkezet/i.test(all))
    return 'roof';
  if (/válaszfal|valaszfal/i.test(all)) return 'partition';
  if (/^F\s*\d*\b/i.test(title) || /határoló fal|hatarolo fal|homlokzati fal/i.test(title))
    return 'wall';
  if (/^T\s*\d*\b/i.test(title)) return 'roof';
  if (/^M\s*\d*\b/i.test(title)) return 'slab';
  if (/^P\s*\d*\b/i.test(title) || /aljzat|padló|padlo/i.test(title)) return 'floor';
  return '';
}

function layerValue(layer) {
  const thickness = text(layer.thickness);
  const material = text(layer.material);
  if (!material) return '';
  return thickness ? thickness+' '+material : material;
}

function findLayer(block, pattern) {
  const layers = (block?.layers || []).filter(layer => pattern.test(text(layer.material)));
  if (!layers.length) return null;
  // A legvastagabb találat a leginkább szerkezeti jellegű réteg.
  return layers.map(layer => ({layer, size:numericThickness(layer.thickness) ?? -1}))
    .sort((a,b) => b.size - a.size)[0].layer;
}

function structuralLayer(block, kind) {
  const pattern = TYPE_LAYER[kind] || /./;
  const layers = (block?.layers || []).filter(layer => {
    const material = text(layer.material);
    if (!material || FINISH.test(material)) return false;
    return pattern.test(material);
  });
  if (!layers.length) return null;
  // A legnagyobb vastagságú réteg a szerkezeti hordozó.
  return layers.map(layer => ({layer, size:numericThickness(layer.thickness) ?? -1}))
    .sort((a,b) => b.size - a.size)[0].layer;
}

function blockFacts(block) {
  const kind = classify(block);
  const layerKind = kind === 'roof' ? 'roofFrame' : kind;
  const structure = structuralLayer(block, layerKind) ||
    findLayer(block, TYPE_LAYER[layerKind] || /./);
  const insulation = findLayer(block,
    /eps|xps|kőzetgyapot|kozetgyapot|hőszigetelés|hoszigeteles|üveggyapot|uveggyapot/i);
  const covering = kind === 'roof' ? findLayer(block, TYPE_LAYER.roofCover) : null;
  return {
    kind,
    origin:block.origin || 'sheet',
    source:block.source || '',
    id:text(block.title).split(/\s/)[0],
    title:text(block.title),
    material:structure ? text(structure.material) : '',
    thickness:structure ? text(structure.thickness) : '',
    insulation:insulation ? layerValue(insulation) : '',
    covering:covering ? layerValue(covering) : '',
    coveringMaterial:covering ? text(covering.material) : '',
    layers:block.layers
  };
}

// A sablon munkalap sorai: fejlécsor (A-ban szöveg, B üres), majd
// [vastagság, anyag] párok. Üres sor zárja a blokkot.
// A munkalap fejlécsora: betűjel + név (F Határoló fal), vagy besoroló
// kulcsszó (P Belső padló). A réteg anyaga sosem fejléc.
const ROW_HEADER = /^[FMTK]\s*\d*\s+\S|\b(fal|födém|fodem|tető|teto|magastető|magasteto|válaszfal|valaszfal|aljzat|padló|padlo|szerkezet)\b/i;
function isHeaderRow(value) {
  const textValue = text(value);
  return textValue.length <= 90 && ROW_HEADER.test(textValue);
}

function retegekFromRows(rows) {
  const blocks = [];
  let current = null;
  for (const row of rows || []) {
    const a = text(row?.[0]), b = text(row?.[1]);
    if (!a && !b) {current = null; continue;}
    if (a && !b && !/^[\d,.]+\s*(?:cm|mm|rtg)?$/i.test(a) && isHeaderRow(a)) {
      current = {id:a.split(/\s/)[0], title:a,layers:[],origin:'sheet'};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (b) current.layers.push({thickness:/^\d/.test(a)?a:'', material:b});
    else if (a) current.layers.push({thickness:'', material:a});
  }
  return blocks.filter(block => block.layers.length);
}

// A szövegblokk sorai: a „Rétegrendek:” címsor utáni sorok a következő
// címsorig / az „É” jelölésig / a rajzi megjegyzések kezdetéig. A blokkon
// kívüli szöveget nem olvassuk be. Layout módban csak a sor végi whitespace-t
// vágjuk le, mert a sor eleji szóközök adják az oszlopkoordinátákat.
function regionsOf(source, layout) {
  const lines = String(source || '').split(/\r?\n/)
    .map(line => layout ? line.replace(/\s+$/,'') : text(line))
    .filter(line => line.trim());
  const regions = [];
  let current = null;
  for (const line of lines) {
    const probe = text(line);
    if (REGION.test(probe)) {current = []; regions.push(current); continue;}
    if (!current) continue;
    if (END.test(probe)) {current = null; continue;}
    current.push(line);
  }
  return regions.filter(region => region.length);
}

function isOnlyThickness(line) {
  const tokens = tokensOf(line);
  if (!tokens.length) return false;
  return tokens.join('').replace(/\s+/g,'') === text(line).replace(/\s+/g,'');
}

function isMaterialLine(line) {
  const value = text(line);
  if (value.length < 3) return false;
  if (DRAWING_ID.test(value)) return false;
  if (!/[a-záéíóöőúüű]{3,}/.test(value)) return false;
  return !HEADER.test(value);
}

function blockHeader(line) {
  const match = HEADER.exec(text(line));
  if (!match) return null;
  const id = match[1].toUpperCase()+match[2]+match[3];
  let rest = match[4].trim();
  let tokens = [];
  const trailing = TH_TRAIL.exec(rest);
  if (trailing) {rest = trailing[1].trim(); tokens = tokensOf(trailing[2]);}
  if (!rest || !CONSTRUCTION.test(rest)) return null;
  return {id, title:id+' '+rest, tokens};
}

function leadingThickness(line) {
  const match = TH_LEAD.exec(text(line));
  if (!match) return null;
  if (/^(?:vtg|vastag)\b/i.test(match[2])) return null;
  return {token:match[1], material:match[2]};
}

function regionBlocks(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const head = blockHeader(line);
    if (head) {
      current = {id:head.id, title:head.title, events:[]};
      blocks.push(current);
      head.tokens.forEach(value => current.events.push({type:'t', value}));
      continue;
    }
    if (!current) continue;
    if (isOnlyThickness(line)) {
      tokensOf(line).forEach(value => current.events.push({type:'t', value}));
      continue;
    }
    const lead = leadingThickness(line);
    if (lead) {
      current.events.push({type:'t', value:lead.token});
      current.events.push({type:'m', value:lead.material});
      continue;
    }
    // A szóhatáros kimenetben a vastagság néha a sor végére kerül.
    const trail = TH_TRAIL.exec(text(line));
    if (trail && /[a-záéíóöőúüű]{3,}/i.test(trail[1])) {
      current.events.push({type:'t', value:trail[2]});
      current.events.push({type:'m', value:trail[1]});
      continue;
    }
    if (isMaterialLine(line)) current.events.push({type:'m', value:line});
  }
  return blocks;
}

// A vastagság- és anyagesemények párosítása. A folytató sor és az alapozó nem
// kap saját vastagságot.
function pairLayers(block) {
  const layers = [];
  const queue = [];
  for (const event of block.events) {
    if (event.type === 't') {queue.push(event.value); continue;}
    const material = text(event.value);
    if (!material) continue;
    if (CONTINUATION.test(material) || PRIMER.test(material)) {
      layers.push({thickness:'', material});
      continue;
    }
    layers.push({thickness:queue.shift() || '', material});
  }
  block.layers = layers;
  return block;
}

// A layout-kimenet oszlopai. Egy terven belül több rétegrend-oszlop is lehet,
// ezért oszloponként külön jelöltlistát adunk; a blokkhoz illeszkedő listát
// a nyers anyagsorral való egyezés választja ki.
function columnsOf(region) {
  const counts = new Map();
  for (const line of region) {
    TH_G.lastIndex = 0;
    let match;
    while ((match = TH_G.exec(line))) {
      if (match.index === 0 || /\s{2,}$/.test(line.slice(0,match.index)))
        counts.set(match.index,(counts.get(match.index) || 0)+1);
    }
  }
  return [...counts].filter(([,count]) => count >= 2)
    .sort((a,b) => b[1]-a[1]).map(([index]) => index).slice(0,4);
}

function materialAt(line, column, isHeader) {
  const segments = line.slice(column).replace(/\s+$/,'')
    .split(/\s{2,}/).map(text).filter(Boolean);
  if (!segments.length) return '';
  const start = isHeader || isOnlyThickness(segments[0]) ? 1 : 0;
  for (let i = start; i < segments.length; i++) {
    const segment = segments[i];
    if (isOnlyThickness(segment)) continue;
    let value = segment;
    if (i === 0) {
      const lead = leadingThickness(segment);
      if (lead) value = lead.material;
    }
    if (!isMaterialLine(value) || TITLE_BLOCK.test(value)) continue;
    return value;
  }
  return '';
}

function layoutCandidateLists(source) {
  const map = new Map();
  for (const region of regionsOf(source,true)) {
    for (const column of columnsOf(region)) {
      let current = null;
      for (const line of region) {
        const cell = text(line.slice(column,column+16));
        const head = /^([FMTPKL]\d{0,2}[a-z]?)\s+\S/.exec(cell);
        if (head) {
          const id = head[1].toUpperCase();
          if (!map.has(id)) map.set(id,[]);
          current = [];
          map.get(id).push(current);
          const material = materialAt(line,column,true);
          if (material) current.push(material);
          continue;
        }
        if (!current) continue;
        const material = materialAt(line,column,false);
        if (material) current.push(material);
      }
    }
  }
  for (const [id,lists] of map) {
    map.set(id,lists.map(filterDuplicates).filter(list => list.length));
  }
  return map;
}

function filterDuplicates(list) {
  const seen = new Set();
  return list.filter(value => {
    const key = text(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldContinue(previous, candidate) {
  if (!previous) return false;
  if (CONTINUATION.test(candidate)) return true;
  if (!/^[a-záéíóöőúüű]/.test(candidate)) return false;
  const last = text(previous).split(' ').pop().replace(/[,.;:)]+$/,'');
  return ADJECTIVE_END.test(last);
}

// Az összefolyó anyagsor bontása. Csak azokat a jelölteket használjuk, amelyek
// tényleg benne vannak a sorban; a nem található jelölt más blokkhoz tartozik.
// A sor végén maradó töredék az utolsó réteg folytatása.
function splitRun(run, candidates) {
  let rest = text(run);
  const out = [];
  for (const raw of candidates || []) {
    const candidate = text(raw);
    if (!candidate || !rest) continue;
    const index = rest.toLowerCase().indexOf(candidate.toLowerCase());
    if (index < 0) continue;
    if (index > 0) {
      if (out.length) out[out.length-1] = text(out[out.length-1]+' '+rest.slice(0,index));
      else out.push(text(rest.slice(0,index)));
    }
    const previous = out.length ? out[out.length-1] : '';
    if (index === 0 && shouldContinue(previous,candidate))
      out[out.length-1] = text(previous+' '+candidate);
    else out.push(candidate);
    rest = rest.slice(index+candidate.length).trim();
  }
  if (rest) {
    if (out.length) out[out.length-1] = text(out[out.length-1]+' '+rest);
    else out.push(rest);
  }
  return out.filter(Boolean);
}

// A jelöltlista pontozása: minél több jelölt található a nyers sorban, és
// minél kevesebb kimaradó töredék keletkezik, annál jobb.
function candidateScore(run, candidates) {
  let rest = text(run), matched = 0, fragments = 0, missed = 0;
  for (const raw of candidates || []) {
    const candidate = text(raw);
    if (!candidate || !rest) continue;
    const index = rest.toLowerCase().indexOf(candidate.toLowerCase());
    if (index < 0) {missed++; continue;}
    matched++;
    fragments += index;
    rest = rest.slice(index+candidate.length).trim();
  }
  return matched*1000 - fragments*5 - missed;
}

function bestCandidateList(run, lists) {
  let best = null, bestScore = -Infinity;
  for (const list of lists || []) {
    if (!list.length) continue;
    const score = candidateScore(run,list);
    if (score > bestScore) {best = list; bestScore = score;}
  }
  return best;
}

// A Poppler a nyers kimenetben a rajz szövegét és a rétegrendet összekeverve
// adja (a blokk címsorai és a rétegek külön szövegrészekben kerülnek egymás
// után), ezért ilyenkor a `-layout` kimenet rétegrend-oszlopából olvasunk. Az
// oszlop bal szélét a „Rétegrendek” címsor pozíciója adja; a mellette lévő
// rajzi jegyzeteket a sáv szélessége zárja ki.
const LAYOUT_BAND_WIDTH = 110;
function layoutRegionBlocks(layoutSource) {
  const lines = String(layoutSource || '').split(/\r?\n/);
  let head = -1, left = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /r[eé]tegrendek/i.exec(lines[i]);
    if (!match) continue;
    head = i;
    left = match.index;
    break;
  }
  if (head < 0) return [];
  const region = [];
  for (let i = head + 1; i < lines.length; i++) {
    const segment = lines[i].slice(left, left + LAYOUT_BAND_WIDTH).replace(/\s+$/,'');
    if (!segment.trim()) continue;
    const probe = text(segment);
    if (END.test(probe)) break;
    region.push(segment);
  }
  return regionBlocks(region);
}

// A Poppler `-bbox-layout` kimenete szóhatárokat ad. A rétegrend-oszlopok a
// blokk-címsorok (F1, L1, P1, …) x-koordinátái mentén helyezkednek el; a rajzi
// feliratok más x-en állnak, ezért a címsorok oszlopsávján kívül eső szavakat
// kihagyjuk. Egy terven több rétegrend-oszlop is lehet egymás mellett.
function bboxWords(html) {
  const pages = String(html || '').split(/<page\b/).slice(1);
  const words = [];
  pages.forEach((page,index) => {
    for (const match of page.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g))
      words.push({page:index,x:Number(match[1]),y:Number(match[2]),text:match[5]});
  });
  return words;
}

function bboxVisualLines(html) {
  const words = bboxWords(html);
  const heading = words.find(word => /r[eé]tegrendek/i.test(word.text));
  if (!heading) return {heading:null,lines:[]};
  const pageWords = words.filter(word => word.page === heading.page && word.y > heading.y + 1)
    .sort((a,b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const word of pageWords) {
    const line = lines[lines.length-1];
    if (line && Math.abs(word.y - line.y) <= 3) line.words.push(word);
    else lines.push({y:word.y,words:[word]});
  }
  return {heading,lines};
}

function bboxColumns(lines, heading) {
  const positions = [heading.x];
  for (const line of lines) {
    const words = line.words;
    for (let i = 0; i < words.length - 1; i++) {
      const id = words[i];
      if (!/^[FLPMTK]\d{0,2}[a-z]?$/.test(id.text)) continue;
      const title = words.slice(i+1).find(word => word.x - id.x <= 100);
      if (!title || !CONSTRUCTION.test(title.text)) continue;
      positions.push(id.x);
    }
  }
  const sorted = [...new Set(positions.map(x => Math.round(x)))].sort((a,b) => a-b);
  const columns = [];
  for (const x of sorted)
    if (!columns.length || x - columns[columns.length-1] > 150) columns.push(x);
  return columns;
}

function bboxRegionBlocks(html) {
  const {heading,lines} = bboxVisualLines(html);
  if (!heading) return [];
  const columns = bboxColumns(lines,heading);
  const blocks = [];
  columns.forEach((left,index) => {
    const next = columns[index+1];
    const min = left - 15;
    // A sáv a következő oszlopig tart, de legfeljebb 240 pt széles: a rajzi
    // jegyzetek ennél távolabb kezdődnek.
    const max = Math.min(next ? next - 5 : Infinity, left + 240);
    const columnLines = [];
    for (const line of lines) {
      const value = line.words.filter(word => word.x >= min && word.x < max)
        .sort((a,b) => a.x - b.x).map(word => word.text).join(' ');
      if (value.trim()) columnLines.push(value);
    }
    blocks.push(...regionBlocks(columnLines));
  });
  return blocks;
}

// A nyers szövegből és a hozzá tartozó layout-kimenetből készült blokkok.
function retegekFromText(source, layoutSource, name = '', bboxSource = '') {
  // A szóhatáros kimenet a legmegbízhatóbb: a rajzi szöveget az oszlopsáv
  // zárja ki. Ha nincs, a nyers, majd a layout-kimenet következik.
  let blocks = bboxSource ? bboxRegionBlocks(bboxSource) : [];
  let fromLayout = false;
  if (!blocks.length) blocks = regionsOf(source,false).flatMap(regionBlocks);
  if (!blocks.length && layoutSource) {
    blocks = layoutRegionBlocks(layoutSource);
    fromLayout = blocks.length > 0;
  }
  const candidates = layoutSource && !fromLayout ? layoutCandidateLists(layoutSource) : new Map();
  for (const block of blocks) {
    const tokens = block.events.filter(event => event.type === 't').length;
    const materials = block.events.filter(event => event.type === 'm');
    if (materials.length === 1 && tokens > 1) {
      const list = bestCandidateList(materials[0].value,candidates.get(block.id));
      if (list) {
        const parts = splitRun(materials[0].value,list);
        const at = block.events.findIndex(event => event.type === 'm');
        block.events.splice(at,1,...parts.map(value => ({type:'m', value})));
      }
    }
    block.origin = 'pdf';
    block.source = text(name).replace(/\.pdf$/i,'');
  }
  for (const block of blocks) pairLayers(block);
  return blocks.filter(block => block.layers.length);
}

// A tervlap ugyanazt a rétegrend-blokkot több szövegrétegben is tartalmazhatja.
// Ilyenkor az azonosító szerint a legtöbb réteget adó változat marad meg.
function bestPerPlan(blocks) {
  const entries = [];
  const byKey = new Map();
  for (const block of blocks) {
    if (block.origin !== 'pdf' || !block.id) {
      const entry = {block};
      entries.push(entry);
      continue;
    }
    const key = block.source+'|'+block.id;
    const previous = byKey.get(key);
    if (!previous) {
      const entry = {block};
      byKey.set(key,entry);
      entries.push(entry);
    } else if ((block.layers?.length || 0) > (previous.block.layers?.length || 0)) {
      previous.block = block;
    }
  }
  return entries.map(entry => entry.block);
}

// Azonos nevű blokk több tervlapon is szerepelhet (például a Metszetek 1 és 2
// lapon); ilyenkor a legteljesebb változat marad meg, hogy a leírásban ne
// jelenjen meg ugyanaz a szerkezet kétszer.
function uniqueBlocks(blocks) {
  const byTitle = new Map();
  const result = [];
  for (const block of blocks) {
    const key = block.title.replace(/\s+/g,' ').toLowerCase();
    const previous = byTitle.get(key);
    if (!previous) {
      byTitle.set(key,block);
      result.push(block);
      continue;
    }
    if ((block.layers?.length || 0) > (previous.layers?.length || 0)) {
      result[result.indexOf(previous)] = block;
      byTitle.set(key,block);
    }
  }
  return result;
}

// Pontozás: a teljesebb blokk élvez elsőbbséget, a PDF-blokk apró előnnyel,
// mert a tervlap a részletesebb forrás. Az azonos típusú blokkok közül a
// legjobb kerül a szerkezetleírásba.
function scoreBlock(fact) {
  const layers = fact.layers.filter(layer => text(layer.material)).length;
  let score = layers * 10;
  if (fact.origin === 'pdf') score += 3;
  if (fact.material) score += 5;
  if (fact.thickness) score += 2;
  return score;
}

// A jóváhagyott rétegrend-szöveg egy blokkja: címsor (tervlap nevével) és a
// kívülről befelé haladó, behúzott rétegsorok.
function blockText(block) {
  const title = text(block.title)+(block.source ? ' ('+block.source+')' : '');
  const layers = (block.layers || []).map(layer => {
    const value = layerValue(layer);
    return value ? '  – '+value : '';
  }).filter(Boolean);
  return [title,...layers].join('\n');
}

function retegrendFacts({sheetRows = [], planTexts = []} = {}) {
  const blocks = uniqueBlocks(bestPerPlan([...retegekFromRows(sheetRows),
    ...planTexts.flatMap(entry => retegekFromText(entry.text,entry.layoutText,entry.name,
      entry.bboxText))]));
  const facts = blocks.map(blockFacts);
  const best = kind => {
    const candidates = facts.filter(item => item.kind === kind)
      .sort((a,b) => scoreBlock(b) - scoreBlock(a));
    return candidates[0] || null;
  };
  return {
    blocks,
    facts,
    wall:best('wall'), slab:best('slab'), roof:best('roof'),
    lines:blocks.map(blockText).filter(Boolean)
  };
}

// A szerkezetleírás és a tűzvédelmi leírás {{...}} jelölőinek értékei.
function retegrendValues(result) {
  const wall = result?.wall, slab = result?.slab, roof = result?.roof;
  // A rétegsor végén maradhat elválasztó (a folytató sor miatt); a mondatba
  // illesztve ez felesleges.
  const clean = value => text(value).replace(/[,;]\s*$/,'');
  // A sablon mondatába illesztve a „falazóelemből”, illetve a „fedéssel” szó
  // következik, ezért a réteg nevéből a záró azonos szót lehagyjuk.
  const without = (value,word) => clean(value).replace(new RegExp('\\s*'+word+'\\s*$','i'),'');
  return {
    'retegrend:fal_anyag': without(wall?.material,'falazóelem') ||
      GAP+' teherhordó fal anyaga – F1 rétegrend a Metszetek tervlapról.]',
    'retegrend:fal_vastagsag': clean(wall?.thickness) ||
      GAP+' teherhordó fal vastagsága – F1 rétegrend.]',
    'retegrend:fal_hoszigeteles': clean(wall?.insulation) ||
      GAP+' homlokzati hőszigetelés – F1 rétegrend.]',
    'retegrend:fodem': slab ? clean([slab.thickness,slab.material].filter(Boolean).join(' ')) :
      GAP+' födém anyaga és vastagsága – M1 rétegrend.]',
    'retegrend:fedelszek': roof ? clean([roof.thickness,roof.material].filter(Boolean).join(' ')) :
      GAP+' fedélszék anyaga – T1 rétegrend.]',
    // A héjalásnál a vastagság (pl. szarufaméret) nem tartozik a fedéshez.
    'retegrend:teto': without(roof?.coveringMaterial,'fedés') ||
      clean(roof?.layers?.map(layerValue).filter(Boolean).slice(0,2).join(', ')) ||
      GAP+' tetőhéjalás – T1 rétegrend.]'
  };
}

module.exports = {retegekFromRows,retegekFromText,retegrendFacts,retegrendValues,classify,blockText};
