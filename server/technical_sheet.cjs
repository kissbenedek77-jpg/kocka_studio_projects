'use strict';

const ADDRESSES = ['B2','B3','B5','B6','B7','E2','H2','H3','H5','H7',
  'E6','E8','B9','E9','J2','J5'];
const SHEET_PREFIX = 'TERVEZESI_ADATOK:Munkalap1!';

function technicalSheetValues(rows) {
  if (!Array.isArray(rows)) throw new Error('A projektadatlapon nincs Munkalap1.');
  const out = {};
  for (const address of ADDRESSES) {
    const column = address.charCodeAt(0)-65;
    const index = Number(address.slice(1))-1;
    const value = String(rows[index]?.[column] ?? '').trim();
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

module.exports = {ADDRESSES, technicalSheetValues, technicalProgramLines};
