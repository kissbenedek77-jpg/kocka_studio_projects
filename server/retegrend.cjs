'use strict';

// Rétegrend-feldolgozás. A bemenet a „Rétegrend sablonok” munkalap soraiból
// és/vagy a Metszetek tervlap szövegéből származó blokkok listája. A generátor
// ebből nyeri a fal-, födém- és fedélszerkezet anyagát és vastagságát; hiányzó
// adat helyén hiányjelölés marad, anyagot nem találunk ki.
//
// A Metszetek tervlap szövege összefolyó (a rajzi feliratok és a rétegrendek
// keverednek), ezért csak a whitelistelt blokkfejlécet követő, vastagság + anyag
// alakú sorokat fogadjuk el. Minden más sor rajzi felirat, és kimarad.
const GAP = '[KIEGÉSZÍTENDŐ:';
const CONSTRUCTION = /fal|födém|fodem|fedél|fedel|tető|teto|magastető|magasteto|válaszfal|valaszfal|aljzat|padló|padlo|szerkezet|burkolat/i;
const HEADER = /^([FMTK])\s*(\d{0,2})\s*[.:–-]?\s*(.{2,90})$/;
const LAYER = /^(\d+(?:[.,]\d+)?\s*(?:cm|mm|rtg)|\d+\s*rtg)\s+(.+)$/i;
const DRAWING = /M\s*=\s*1:|lépték|leptek|tervlap|metszet|alaprajz|homlokzat|helyszínrajz|helyszinrajz|^\s*EK-|\d+\s*\/\s*\d+/i;

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

function numericThickness(value) {
  const match = /(\d+(?:[.,]\d+)?)\s*(cm|mm)?/i.exec(text(value));
  if (!match) return null;
  const number = Number(match[1].replace(',','.'));
  return match[2] && /mm/i.test(match[2]) ? number/10 : number;
}

function classify(block) {
  const title = text(block?.title);
  const all = [title,...(block?.layers || []).map(layer => layer.material)].join(' ');
  // A sorrend fontos: a „Födém” nem határoló fal, a „Magastető” nem födém.
  if (/födém|fodem|födémlemez|fodemlemez/i.test(all)) return 'slab';
  if (/fedél|fedel|magastető|magasteto|tetőhéjalás|tetohejalas|tetőszerkezet|tetoszerkezet/i.test(all))
    return 'roof';
  if (/válaszfal|valaszfal/i.test(all)) return 'partition';
  if (/^F\s*\d*\b/i.test(title) || /határoló fal|hatarolo fal|homlokzati fal/i.test(title))
    return 'wall';
  if (/^T\s*\d*\b/i.test(title)) return 'roof';
  if (/^M\s*\d*\b/i.test(title)) return 'slab';
  if (/aljzat|padló|padlo/i.test(title)) return 'floor';
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
  if (!kind) return null;
  const layerKind = kind === 'roof' ? 'roofFrame' : kind;
  const structure = structuralLayer(block, layerKind) ||
    findLayer(block, TYPE_LAYER[layerKind] || /./);
  const insulation = findLayer(block,
    /eps|xps|kőzetgyapot|kozetgyapot|hőszigetelés|hoszigeteles|üveggyapot|uveggyapot/i);
  const covering = kind === 'roof' ? findLayer(block, TYPE_LAYER.roofCover) : null;
  return {
    kind,
    origin:block.origin || 'sheet',
    id:text(block.title).split(/\s/)[0],
    title:text(block.title),
    material:structure ? text(structure.material) : '',
    thickness:structure ? text(structure.thickness) : '',
    insulation:insulation ? layerValue(insulation) : '',
    covering:covering ? layerValue(covering) : '',
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
      current = {title:a,layers:[],origin:'sheet'};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (b) current.layers.push({thickness:/^\d/.test(a)?a:'', material:b});
    else if (a) current.layers.push({thickness:'', material:a});
  }
  return blocks.filter(block => block.layers.length);
}

// A Metszetek tervlap szövegéből kiolvasott blokkok. Csak a whitelistelt
// blokkfejléc (F1, M1, T1, K1 stb.) után következő, vastagság + anyag alakú
// sorok kerülnek be; a rajzi feliratok kimaradnak.
function retegekFromText(source) {
  const lines = String(source || '').split(/\r?\n/)
    .map(line => line.replace(/\s+/g,' ').trim()).filter(Boolean);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.length > 200 || DRAWING.test(line)) continue;
    const head = line.match(HEADER);
    if (head && CONSTRUCTION.test(head[3])) {
      current = {title:(head[1].toUpperCase()+(head[2]||''))+' '+head[3].trim(),
        layers:[],origin:'pdf'};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const layer = line.match(LAYER);
    if (layer) current.layers.push({thickness:layer[1], material:layer[2]});
  }
  return blocks.filter(block => block.layers.length);
}

function uniqueBlocks(blocks) {
  const seen = new Set();
  return blocks.filter(block => {
    const key = block.title.replace(/\s+/g,' ').toLowerCase()+'|'+
      block.layers.map(layer => text(layer.thickness)+' '+text(layer.material)).join(';').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function retegrendFacts({sheetRows = [], planTexts = []} = {}) {
  const blocks = uniqueBlocks([...retegekFromRows(sheetRows),
    ...planTexts.flatMap(entry => retegekFromText(entry.text))]);
  const facts = blocks.map(blockFacts).filter(Boolean);
  const best = kind => {
    const candidates = facts.filter(item => item.kind === kind)
      .sort((a,b) => scoreBlock(b) - scoreBlock(a));
    return candidates[0] || null;
  };
  return {
    blocks,
    facts,
    wall:best('wall'), slab:best('slab'), roof:best('roof'),
    lines:facts.map(item => [item.title, ...item.layers.map(layerValue).filter(Boolean)]
      .join('\n')).filter(Boolean)
  };
}

// A szerkezetleírás és a tűzvédelmi leírás {{...}} jelölőinek értékei.
function retegrendValues(result) {
  const wall = result?.wall, slab = result?.slab, roof = result?.roof;
  return {
    'retegrend:fal_anyag': wall?.material ||
      GAP+' teherhordó fal anyaga – F1 rétegrend a Metszetek tervlapról.]',
    'retegrend:fal_vastagsag': wall?.thickness ||
      GAP+' teherhordó fal vastagsága – F1 rétegrend.]',
    'retegrend:fal_hoszigeteles': wall?.insulation ||
      GAP+' homlokzati hőszigetelés – F1 rétegrend.]',
    'retegrend:fodem': slab ? [slab.thickness,slab.material].filter(Boolean).join(' ') :
      GAP+' födém anyaga és vastagsága – M1 rétegrend.]',
    'retegrend:fedelszek': roof ? [roof.thickness,roof.material].filter(Boolean).join(' ') :
      GAP+' fedélszék anyaga – T1 rétegrend.]',
    'retegrend:teto': roof?.covering || roof?.layers?.map(layerValue).filter(Boolean).slice(0,2).join(', ') ||
      GAP+' tetőhéjalás – T1 rétegrend.]'
  };
}

module.exports = {retegekFromRows,retegekFromText,retegrendFacts,retegrendValues,classify};
