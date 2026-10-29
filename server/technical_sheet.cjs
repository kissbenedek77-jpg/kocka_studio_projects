'use strict';

const {programLines} = require('./technical_program.cjs');

// A Tervezési adatok Template → Munkalap1 értékcellái. A címkecellák (H2, H3,
// H5, H7) szándékosan nincsenek köztük: azok szöveget tartalmaznak.
//   B-oszlop: hatósági/övezeti követelmény
//   E/F:     meglévő / tervezett (D-blokk)
//   I/J:     meglévő / tervezett (H-blokk)
//   L/M:     meglévő / tervezett arány (%) képlettel
const ADDRESSES = ['B2','B3','B5','B6','B7','B9',
  'E2','E6','E8','E9','F2','F6','F8','F9',
  'I2','I3','I5','I7','J2','J3','J5','J7',
  'L2','L5','L7','M2','M5','M7'];
const SHEET_PREFIX = 'TERVEZESI_ADATOK:Munkalap1!';
// A B3 és B5 a dokumentumban „… %” utótagot kap, ezért a cella saját
// százalékjelét levágjuk – így a „30” és a „30%” beírás is helyes képet ad.
const PERCENT_ADDRESSES = new Set(['B3','B5']);

function technicalSheetValues(rows) {
  if (!Array.isArray(rows)) throw new Error('A projektadatlapon nincs Munkalap1.');
  const out = {};
  for (const address of ADDRESSES) {
    const column = address.charCodeAt(0)-65;
    const index = Number(address.slice(1))-1;
    let value = String(rows[index]?.[column] ?? '').trim();
    if (PERCENT_ADDRESSES.has(address)) value = value.replace(/\s*%\s*$/,'').trim();
    if (/^#(?:ERROR!|REF!|DIV\/0!|VALUE!|N\/A|NUM!|NAME\?|NULL!)/i.test(value))
      throw new Error('Képlethiba a projektadatlapon: Munkalap1!'+address);
    out[SHEET_PREFIX+address] = value;
  }
  return out;
}

// A tervezési program a)–p) sorai a „Tervezési program” lapról jönnek. Ha egy
// sor üres, a kanonikus alapértelmezett szöveg lép a helyére; a {{...}}
// jelölőket a projektadatok töltik ki.
function technicalProgramLines(rows, replacements) {
  return programLines(Array.isArray(rows) ? rows : [],replacements);
}

module.exports = {ADDRESSES, SHEET_PREFIX, technicalSheetValues, technicalProgramLines};
