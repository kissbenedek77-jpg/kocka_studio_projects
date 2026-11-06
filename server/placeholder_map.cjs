'use strict';

// A /technical oldalon megjelenő {{...}} helyőrzők forrástáblái. Csak azok a
// helyőrzők módosíthatók, amelyeknek egyértelműen megvan a tábla/cella
// hivatkozásuk. A számított értékek (tervjegyzék, parkolóegyenleg,
// tűzszakasz, kijárat, rétegrend stb.) itt nem szerkeszthetők.
const {FIELDS} = require('./domain.cjs');
const {MANUAL_FIELDS} = require('./technical_document.cjs');

const CLIENT_FIELD_MAP = {
  'projekt_cim':'projektCim',
  'Hrsz':'hrsz',
  'Telefon':'telefon',
  'Email cím':'email',
  'Adóazonosító':'adoazonosito',
  'Állampolgárság':'allampolgarsag',
  'Anyja neve':'anyjaNeve',
  'Születési hely':'szuletesiHely',
  'Születési idő':'szuletesiIdo',
  'Vezetéknév':'vezeteknev',
  'Keresztnév':'keresztnev',
  'Születési név':'szuletesiNev',
  'lakcim_cim':'lakcim',
  'ertesitesi_cim':'ertesitesiCim',
  'projekt Irányítószám':'projekt_irsz',
  'projekt Város':'projekt_varos',
  'projekt Közterület':'projekt_kozterulet',
  'projekt Típus':'projekt_tipus',
  'projekt Házszám':'projekt_hazszam',
  'projekt Egyéb':'projekt_egyeb',
  'telepules':'projekt_varos',
  'Neve':'projektTipusStored'
};

// A „Tervezési adatok” Munkalap1 lapján csak a beviteli cellák szerkeszthetők.
// A számított cellák (L2, L5, L7, M2, M5, M7, J5) képletet tartalmaznak, ezért
// azok itt nem írhatók felül.
const MUNKALAP_INPUT_CELLS = new Set(['B2','B3','B5','B6','B7','B9',
  'E2','E6','E8','E9','F6','F8','F9','J2','J3','J7']);
// A teljes cím az összetevőkből képződik; a város szerkesztésekor a projekt
// címe is újraszámolódik, hogy ne szakadjon el egymástól.
const ADDRESS_PARTS = {projekt_varos:'projektCim'};

function columnLetter(index) {
  let result = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - remainder - 1) / 26);
  }
  return result;
}

function clientColumn(fieldKey) {
  const field = CLIENT_FIELD_MAP[fieldKey];
  return field ? FIELDS.indexOf(field) : -1;
}

function placeholderTarget(key) {
  const munkalap = /^TERVEZESI_ADATOK:Munkalap1!([A-Z]+\d+)$/.exec(key);
  if (munkalap) return MUNKALAP_INPUT_CELLS.has(munkalap[1])
    ? {type:'munkalap',cell:munkalap[1]} : null;
  const column = clientColumn(key);
  if (column >= 0) return {type:'client',field:CLIENT_FIELD_MAP[key],column};
  if (MANUAL_FIELDS.some(([manualKey]) => manualKey === key))
    return {type:'field',key};
  return null;
}

// A teljes cím képzése a projekt címösszetevőiből (az űrlap buildAddress
// függvényével azonos módon).
function composeAddress(data) {
  const prefix = [data.projekt_irsz,data.projekt_varos].filter(Boolean).join(' ');
  const street = [data.projekt_kozterulet,data.projekt_tipus,data.projekt_hazszam]
    .filter(Boolean).join(' ');
  let address = prefix;
  if (street) address += (address ? ', ' : '') + street;
  if (data.projekt_egyeb) address += (address ? ' ' : '') + data.projekt_egyeb;
  return address.trim();
}

module.exports = {CLIENT_FIELD_MAP,MUNKALAP_INPUT_CELLS,ADDRESS_PARTS,
  columnLetter,clientColumn,placeholderTarget,composeAddress};
