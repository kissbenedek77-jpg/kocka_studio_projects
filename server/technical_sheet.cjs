'use strict';

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

function technicalProgramLines(rows, replacements) {
  if (!Array.isArray(rows) || rows.length < 16)
    throw new Error('A tervezési program a–p pontjai hiányoznak.');
  return Array.from({length:16},(_,index) => {
    const letter = String.fromCharCode(97+index);
    const row = rows[index] || [];
    const raw = String(row[1] ?? '').trim();
    if (String(row[0] ?? '').trim() !== letter || !raw.startsWith(letter+')'))
      throw new Error('A tervezési program '+letter+') pontja hiányzik vagy hibás.');
    const text = raw.replace(/\{\{([^{}]+)\}\}/g,(marker,key) => {
      if (!Object.prototype.hasOwnProperty.call(replacements,key) ||
          !String(replacements[key] ?? '').trim())
        throw new Error('Hiányzó projektadat a tervezési programban: '+key);
      return String(replacements[key]);
    });
    return text.split(/\r?\n/).filter(line => line.trim());
  });
}

module.exports = {ADDRESSES, SHEET_PREFIX, technicalSheetValues, technicalProgramLines};
