'use strict';

// Rétegrend-feldolgozás. A bemenet a „Rétegrend sablonok” munkalap soraiból
// és/vagy a Metszetek tervlap szövegéből származó blokkok listája. A generátor
// ebből nyeri a fal-, födém- és fedélszerkezet anyagát és vastagságát; hiányzó
// adat helyén hiányjelölés marad, anyagot nem találunk ki.
const GAP = '[KIEGÉSZÍTENDŐ:';
const ID = /^([FMT])(\d*)\b[\s.:–-]*(.*)$/i;

function text(value) {return String(value ?? '').replace(/\s+/g,' ').trim();}

function classify(block) {
  const title = block.title || '';
  const all = ([title,...block.layers.map(layer => layer.material)]).join(' ');
  if (/^F/i.test(title) || /határoló fal|homlokzati fal/i.test(title)) return 'wall';
  if (/^M/i.test(title) || /födém/i.test(title)) return 'slab';
  if (/^T/i.test(title) || /fedél|tető/i.test(title)) return 'roof';
  if (/válaszfal/i.test(title)) return 'partition';
  if (/aljzat|padló/i.test(title)) return 'floor';
  return '';
}

function layerValue(layer) {
  const thickness = text(layer.thickness);
  const material = text(layer.material);
  if (!material) return '';
  return thickness ? thickness+' '+material : material;
}

function findLayer(block, pattern) {
  return block.layers.find(layer => pattern.test(layer.material)) || null;
}

function blockFacts(block) {
  const kind = classify(block);
  if (!kind) return null;
  const material = block.layers.find(layer =>
    /falazat|tégla|kerámia|vasbeton|beton|fa|szerkezet|burkolat/i.test(layer.material)) || null;
  const insulation = findLayer(block, /eps|xps|kőzetgyapot|hőszigetelés|üveggyapot/i);
  return {kind, id:text(block.title).split(/\s/)[0], title:text(block.title),
    material:material ? text(material.material) : '',
    thickness:material ? text(material.thickness) : '',
    insulation:insulation ? layerValue(insulation) : '',
    layers:block.layers};
}

// A sablon munkalap sorai: fejlécsor (A-ban szöveg, B üres), majd
// [vastagság, anyag] párok. Üres sor zárja a blokkot.
function retegekFromRows(rows) {
  const blocks = [];
  let current = null;
  for (const row of rows || []) {
    const a = text(row?.[0]), b = text(row?.[1]);
    if (!a && !b) {current = null; continue;}
    if (a && !b && !/^[\d,.]+\s*(?:cm|mm|rtg)?$/i.test(a)) {
      current = {title:a,layers:[]};
      blocks.push(current);
      continue;
    }
    if (!current) {
      current = {title:'',layers:[]};
      blocks.push(current);
    }
    if (b || (!a && b)) current.layers.push({thickness:/^\d|^\d+[.,]\d+/.test(a)?a:'', material:b || a});
    else if (a) current.layers.push({thickness:'', material:a});
  }
  return blocks.filter(block => block.layers.length);
}

// A Metszetek tervlap szövegéből kiolvasott blokkok. A tervlapokon a rétegrend
// azonosítója (F1, M1, T1) után következnek a rétegek, vastagsággal.
function retegekFromText(source) {
  const lines = String(source || '').split(/\r?\n/).map(line => line.replace(/\s+/g,' ').trim());
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (!line) continue;
    const head = line.match(ID);
    if (head && (!current || current.layers.length || /fal|födém|fedél|tető|válaszfal|aljzat/i.test(head[3]))) {
      current = {title:(head[1].toUpperCase()+(head[2]||''))+(head[3]?' '+head[3]:''),layers:[]};
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const layer = line.match(/^(\d+(?:[.,]\d+)?\s*(?:cm|mm|rtg)?)\s+([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű].+)$/);
    if (layer) current.layers.push({thickness:layer[1], material:layer[2]});
    else if (line.length > 3 && line.length < 160 && !/[;:]$/.test(line))
      current.layers.push({thickness:'', material:line});
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

function retegrendFacts({sheetRows = [], planTexts = []} = {}) {
  const blocks = uniqueBlocks([...retegekFromRows(sheetRows),
    ...planTexts.flatMap(entry => retegekFromText(entry.text))]);
  const facts = blocks.map(blockFacts).filter(Boolean);
  const first = kind => facts.find(item => item.kind === kind) || null;
  return {
    blocks,
    facts,
    wall:first('wall'), slab:first('slab'), roof:first('roof'),
    lines:facts.map(item => [item.title, ...item.layers.map(layerValue).filter(Boolean)]
      .join('\n')).filter(Boolean)
  };
}

// A szerkezetleírás és a tűzvédelmi leírás {{...}} jelölőinek értékei.
function retegrendValues(result) {
  const wall = result?.wall, slab = result?.slab, roof = result?.roof;
  const wallMaterial = wall?.material || '';
  return {
    'retegrend:fal_anyag': wallMaterial ||
      GAP+' teherhordó fal anyaga – F1 rétegrend a Metszetek tervlapról.]',
    'retegrend:fal_vastagsag': wall?.thickness ||
      GAP+' teherhordó fal vastagsága – F1 rétegrend.]',
    'retegrend:fal_hoszigeteles': wall?.insulation ||
      GAP+' homlokzati hőszigetelés – F1 rétegrend.]',
    'retegrend:fodem': slab ? [slab.thickness,slab.material].filter(Boolean).join(' ') :
      GAP+' födém anyaga és vastagsága – M1 rétegrend.]',
    'retegrend:fedelszek': roof ? (roof.material || (roof.layers[0]?.material || '')) :
      GAP+' fedélszék anyaga – T1 rétegrend.]',
    'retegrend:teto': roof?.layers?.map(layerValue).filter(Boolean).slice(0,3).join(', ') ||
      GAP+' tetőhéjalás – T1 rétegrend.]'
  };
}

module.exports = {retegekFromRows,retegekFromText,retegrendFacts,retegrendValues,classify};
